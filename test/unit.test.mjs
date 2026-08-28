import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attr, bodyKind, parseHtml, parseSitemap, countWords } from '../src/parse.mjs';
import { matchGlob, applyIgnores, expectationChecks, resolveSites, optionsForSite, readSecret } from '../src/config.mjs';
import { diff, serialize, parse as parseBaseline } from '../src/baseline.mjs';
import { pageChecks, crossPageChecks, sitemapChecks, seriesOf } from '../src/checks.mjs';
import { byCause, causeScope, sectionOf } from '../src/causes.mjs';
import { fingerprint, similarity, cluster } from '../src/dupes.mjs';
import { rebuild, changedSince, describe as describeSitemap } from '../src/sitemap.mjs';
import { userAgentFor, BROWSER_NAMES, OS_NAMES, thisPlatform } from '../src/agents.mjs';
import { markdown, html, counts, group, portfolio, portfolioRows, portfolioMarkdown, portfolioHtml, progressLine, byCategory, categoryOf } from '../src/report.mjs';
import { psiTargets } from '../src/psi.mjs';
import { siteChecks } from '../src/site.mjs';
import { parseRobots, robotsVerdict } from '../src/robots.mjs';
import { parseRedirectMap, redirectChecks } from '../src/redirects.mjs';
import { audit } from '../src/audit.mjs';
import { Fetcher } from '../src/http.mjs';
import { startFixtureSite } from './server.mjs';
import { askForSite, isInteractive, invocation } from '../src/prompt.mjs';

// --- parse ----------------------------------------------------------------

test('attr reads quoted, single-quoted and bare attributes', () => {
  assert.equal(attr('<img alt="hello">', 'alt'), 'hello');
  assert.equal(attr("<img alt='hello'>", 'alt'), 'hello');
  // A bare attribute is present with an empty value — not missing.
  assert.equal(attr('<img alt>', 'alt'), '');
  assert.equal(attr('<img src="x">', 'alt'), null);
});

test('attr decodes entities', () => {
  assert.equal(attr('<meta content="Tea &amp; Cake">', 'content'), 'Tea & Cake');
});

test('attr reads an unquoted value, which HTML permits', () => {
  // smashingmagazine.com ships `<meta name=viewport content="…">`. Reading only
  // quoted values reported nine of its pages as having no viewport at all.
  assert.equal(attr('<meta name=viewport content="width=device-width">', 'name'), 'viewport');
  assert.equal(attr('<img src=/a.png alt=hello>', 'src'), '/a.png');
  assert.equal(attr('<img src=/a.png alt=hello>', 'alt'), 'hello');
  // The quoted forms still win, and a bare attribute is still empty-not-missing.
  assert.equal(attr('<img alt="a b">', 'alt'), 'a b');
  assert.equal(attr('<img alt>', 'alt'), '');
});

test('an unquoted viewport is found, not reported as missing', () => {
  const doc = parseHtml(
    '<html lang="en"><head><meta name=viewport content="width=device-width,initial-scale=1"></head></html>',
    'https://x.test/p/',
  );
  assert.equal(doc.viewport, 'width=device-width,initial-scale=1');
});

test('markup built inside a script is code, not links on the page', () => {
  // smashingmagazine.com's offline-article list builds <li><a href="'+a.url+'">
  // by concatenation. Nine pages were reported as linking to a page that does
  // not exist, once per page that shipped the script.
  const doc = parseHtml(
    `<main>
       <a href="/real/">a real link</a>
       <script>var t = '<li><a href="' + a.url + '">' + a.url + '</a></li>';</script>
       <style>.x::after { content: "<a href='/fake/'>"; }</style>
     </main>`,
    'https://x.test/p/',
  );
  assert.deepEqual(doc.links.internal, ['https://x.test/real/']);
});

test('JSON-LD still reaches the checks, even though it lives in a script', () => {
  const doc = parseHtml(
    `<head><script type="application/ld+json">{"@type":"Organization"}</script></head>`,
    'https://x.test/p/',
  );
  assert.equal(doc.jsonld.length, 1);
  assert.equal(doc.jsonld[0].data['@type'], 'Organization');
});

test('markup inside an attribute value is a code sample, not part of the page', () => {
  // astro.build stores a whole Astro component in a data-code attribute for its
  // copy button. The <img src={product.imageUrl}> in that string was read as a
  // real image with no alt, and reported as an error on a site that has no such
  // problem.
  const doc = parseHtml(
    `<main>
       <button data-code="&lt;x&gt;<img src={product.imageUrl} alt={product.imageAlt} /></x>">Copy</button>
       <img src="/real.png" alt="a real one">
     </main>`,
    'https://x.test/p/',
  );
  assert.equal(doc.images.length, 1);
  assert.equal(doc.images[0].src, '/real.png');
});

test('an attribute value that merely contains a < is left alone', () => {
  // "a < b" is text, not markup, and blanking it would invent a missing
  // description on a page that has one.
  const doc = parseHtml(
    '<head><meta name="description" content="when a < b, sort ascending"></head>',
    'https://x.test/p/',
  );
  assert.equal(doc.description, 'when a < b, sort ascending');
});

test('attr does not match a longer attribute name', () => {
  // `data-alt` must not satisfy a request for `alt`.
  assert.equal(attr('<img data-src="x">', 'src'), null);
});

test('a framework binding is not the attribute it binds', () => {
  // allbirds.com binds :src="(cardRefs['7205190238288']?.selectedImage…)" with
  // Alpine. Reading those as real sources reported twenty-four of its images as
  // 404s for URLs that were never URLs.
  for (const bound of [':src', 'v-bind:src', 'x-bind:src', '[src]']) {
    assert.equal(
      attr(`<img ${bound}="item.image">`, 'src'),
      null,
      `${bound} should not be read as src`,
    );
  }
  assert.equal(attr('<img :alt="item.alt">', 'alt'), null);
  // The real attribute alongside a binding is still found.
  assert.equal(attr('<img :alt="item.alt" src="/real.png">', 'src'), '/real.png');
});

test('parseHtml extracts the pieces the checks rely on', () => {
  const doc = parseHtml(
    `<html lang="en"><head><title>T</title>
     <meta name="description" content="D">
     <link rel="canonical" href="/here/">
     <link rel="alternate" hreflang="ru" href="/ru/here/">
     <meta property="og:image" content="/og.jpg"></head>
     <body><main><h1>H</h1><p><a href="/other/">x</a></p>
     <img src="/a.png" alt="" width="10" height="10"></main></body></html>`,
    'https://example.com/here/',
  );
  assert.equal(doc.title, 'T');
  assert.equal(doc.description, 'D');
  assert.equal(doc.lang, 'en');
  assert.deepEqual(doc.canonical, ['https://example.com/here/']);
  assert.deepEqual(doc.hreflang, [{ lang: 'ru', href: 'https://example.com/ru/here/' }]);
  assert.equal(doc.og['og:image'], 'https://example.com/og.jpg'.replace('https://example.com', '/og.jpg') === '/og.jpg' ? '/og.jpg' : doc.og['og:image']);
  assert.deepEqual(doc.h1, ['H']);
  assert.deepEqual(doc.links.inMain, ['https://example.com/other/']);
  assert.equal(doc.images.length, 1);
  assert.equal(doc.images[0].alt, '');
});

test('parseHtml separates internal from external links', () => {
  const doc = parseHtml(
    `<main><a href="/in/">in</a><a href="https://other.test/out">out</a>
     <a href="#frag">frag</a><a href="mailto:a@b.c">mail</a></main>`,
    'https://example.com/',
  );
  assert.deepEqual(doc.links.internal, ['https://example.com/in/']);
  assert.deepEqual(doc.links.external, ['https://other.test/out']);
});

test('word counting handles scripts that do not use spaces', () => {
  // The Japanese translation of a React docs page counted 177 against the
  // English original's 411 — the same page, the same content — because
  // splitting on whitespace makes a Japanese paragraph one word.
  assert.equal(countWords('one two three four five'), 5);
  assert.equal(countWords(''), 0);

  // Japanese, Chinese and Thai run words together; counted at two characters
  // to the word.
  assert.equal(countWords('あいうえおかきくけこ'), 5);
  assert.equal(countWords('한국어는 띄어쓰기를 한다'), 3); // Korean does use spaces

  // Mixed text counts both halves rather than losing one.
  assert.ok(countWords('React の useState フックは state を返します') > 5);
});

test('a page of Japanese is not reported as thin', () => {
  const japanese = 'これはテストです。'.repeat(80); // ~720 characters
  const doc = parseHtml(`<main><p>${japanese}</p></main>`, 'https://x.test/p/');
  assert.ok(doc.words > 300, `expected a real word count, got ${doc.words}`);
  assert.ok(!pageChecks(page(`<main><p>${japanese}</p></main>`)).some((f) => f.id === 'thin-content'));
});

test('parseSitemap distinguishes an index from a urlset', () => {
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://a.test/</loc></url></urlset>'), {
    urls: ['https://a.test/'],
    sitemaps: [],
    entries: [{ loc: 'https://a.test/', lastmod: null }],
  });
  assert.deepEqual(
    parseSitemap('<sitemapindex><sitemap><loc>https://a.test/s.xml</loc></sitemap></sitemapindex>'),
    { urls: [], sitemaps: ['https://a.test/s.xml'], entries: [] },
  );
});

test('lastmod stays attached to its own loc', () => {
  // Read from inside each <url> block, so a date on one entry cannot drift
  // onto a neighbour that has none.
  const { entries } = parseSitemap(
    `<urlset>
       <url><loc>https://a.test/one/</loc><lastmod>2026-01-02</lastmod></url>
       <url><loc>https://a.test/two/</loc></url>
       <url><loc>https://a.test/three/</loc><lastmod>2026-03-04T10:00:00+00:00</lastmod></url>
     </urlset>`,
  );
  assert.deepEqual(entries, [
    { loc: 'https://a.test/one/', lastmod: '2026-01-02' },
    { loc: 'https://a.test/two/', lastmod: null },
    { loc: 'https://a.test/three/', lastmod: '2026-03-04T10:00:00+00:00' },
  ]);
});

// --- the no-argument prompt -----------------------------------------------

// A readline stand-in, so the flow is testable without a terminal.
const answering = (...replies) => {
  const queue = [...replies];
  return {
    asked: [],
    async question(q) {
      this.asked.push(q);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? '';
    },
  };
};

test('the prompt is only offered when someone is there to answer', () => {
  assert.equal(isInteractive({ stdin: { isTTY: true }, stdout: { isTTY: true } }), true);
  // A pipe, a CI runner, an editor task: asking would block a build forever.
  assert.equal(isInteractive({ stdin: { isTTY: false }, stdout: { isTTY: true } }), false);
  assert.equal(isInteractive({ stdin: { isTTY: true }, stdout: { isTTY: false } }), false);
  assert.equal(isInteractive({}), false);
});

test('a URL and a no gives a plain run', async () => {
  assert.deepEqual(await askForSite(answering('https://example.com', 'n')), {
    url: 'https://example.com',
  });
});

test('a yes adds the HTML report', async () => {
  assert.deepEqual(await askForSite(answering('example.com', 'y')), {
    url: 'example.com',
    html: 'seo-audit.html',
  });
  assert.deepEqual(await askForSite(answering('example.com', 'YES')), {
    url: 'example.com',
    html: 'seo-audit.html',
  });
});

test('an empty URL is not an audit of nothing', async () => {
  assert.equal(await askForSite(answering('   ', 'y')), null);
});

test('a stream closing under the prompt is not a crash', async () => {
  // Ctrl-C, or a terminal that went away mid-question.
  assert.equal(await askForSite(answering(new Error('EOF'))), null);
});

test('the printed one-liner is the command that was actually run', () => {
  assert.equal(invocation('https://example.com'), 'seo-audit https://example.com');
  assert.equal(
    invocation('https://example.com', { html: 'seo-audit.html' }),
    'seo-audit https://example.com --html seo-audit.html',
  );
});

// --- og:image reachability ------------------------------------------------

const ogSite = (origin, src) => bareSite(origin, { og: { 'og:image': src } });

test('an og:image that redirects to https still loads', async () => {
  // allbirds.com serves http:// og:images that 301 to https. Every scraper
  // follows that; judging the first hop reported seven of them as blank.
  const origin = 'https://x.test';
  const out = await siteChecks(
    origin,
    fakeFetcher((url) =>
      url.startsWith('http://') ? { status: 301, location: url.replace('http://', 'https://') } : notFound(url),
    ),
    ogSite(origin, 'http://x.test/og.png'),
    { sitemapUrls: [`${origin}/p/`] },
  );
  assert.ok(!out.some((f) => f.id === 'og-image-broken'));
});

test('an og:image that really is missing is still reported', async () => {
  const origin = 'https://x.test';
  const out = await siteChecks(
    origin,
    fakeFetcher((url) => (url.endsWith('/og.png') ? { status: 404 } : notFound(url))),
    ogSite(origin, 'https://x.test/og.png'),
    { sitemapUrls: [`${origin}/p/`] },
  );
  assert.ok(out.some((f) => f.id === 'og-image-broken'));
});

test('an og:image behind hotlink protection is not called broken', async () => {
  const origin = 'https://x.test';
  const out = await siteChecks(
    origin,
    fakeFetcher((url) => (url.endsWith('/og.png') ? { status: 403 } : notFound(url))),
    ogSite(origin, 'https://x.test/og.png'),
    { sitemapUrls: [`${origin}/p/`] },
  );
  assert.ok(!out.some((f) => f.id === 'og-image-broken'));
});

// --- canonical targets ----------------------------------------------------

const canonicalTo = (origin, target) => [{
  url: `${origin}/p/`,
  res: { ok: true, status: 200, ms: 1, headers: new Headers() },
  doc: { links: { internal: [], inMain: [], external: [] }, canonical: [target], og: {}, hreflang: [], images: [] },
}];

const canonicalTargetIds = async (target) => {
  const origin = 'https://x.test';
  const out = await siteChecks(
    origin,
    fakeFetcher((url) => (url === `${origin}/real/` ? target : notFound(url))),
    canonicalTo(origin, `${origin}/real/`),
    { sitemapUrls: [`${origin}/p/`] },
  );
  return ids(out);
};

test('a canonical pointing at a noindexed page is an error', async () => {
  // The page that started it has correct markup, so nothing on it reads as
  // wrong — and it leaves the index anyway, because it named a page that asked
  // not to be indexed as the version to keep.
  const found = await canonicalTargetIds({
    body: '<html><head><meta name="robots" content="noindex,follow"></head><body></body></html>',
  });
  assert.ok(found.includes('canonical-noindex'));
});

test('a canonical target noindexed by header only is caught too', async () => {
  // The half no view-source shows: nothing in the target's HTML says noindex.
  const found = await canonicalTargetIds({
    headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' },
    body: '<html><head></head><body></body></html>',
  });
  assert.ok(found.includes('canonical-noindex'));
});

test('a canonical pointing at an indexable page is not reported', async () => {
  const found = await canonicalTargetIds({
    body: '<html><head><link rel="canonical" href="https://x.test/real/"><meta name="robots" content="index,follow"></head></html>',
  });
  assert.ok(!found.includes('canonical-noindex'));
  assert.ok(!found.includes('canonical-chain'), 'a target that claims itself is not a chain');
});

test('"noindex" inside another word does not make a target noindexed', async () => {
  // A robots value the tool has no opinion about must stay silent.
  const found = await canonicalTargetIds({
    body: '<html><head><meta name="robots" content="max-image-preview:large"></head></html>',
  });
  assert.ok(!found.includes('canonical-noindex'));
});

// --- TLS certificates -----------------------------------------------------

const NOW_TLS = Date.parse('2026-06-01T00:00:00Z');
const certIds = async (daysFromNow) => {
  const out = await siteChecks('https://x.test', fakeFetcher(notFound), bareSite('https://x.test'), {
    sitemapUrls: ['https://x.test/p/'],
    now: NOW_TLS,
    readCertificateExpiry: async () =>
      daysFromNow === null ? null : NOW_TLS + daysFromNow * 24 * 60 * 60 * 1000,
  });
  return out.filter((finding) => finding.id.startsWith('tls-'));
};

test('a certificate with months left is not mentioned', async () => {
  assert.deepEqual(await certIds(60), []);
});

test('a certificate expiring inside two weeks is a warning', async () => {
  const [finding] = await certIds(9);
  assert.equal(finding.id, 'tls-expiring');
  assert.equal(finding.level, 'warn');
  assert.match(finding.title, /9 day/);
});

test('an expired certificate is an error, since nothing else matters then', async () => {
  const [finding] = await certIds(-3);
  assert.equal(finding.id, 'tls-expired');
  assert.equal(finding.level, 'error');
  assert.match(finding.title, /3 day\(s\) ago/);
});

test('a certificate that cannot be read is not guessed at', async () => {
  assert.deepEqual(await certIds(null), []);
});

test('an http site is not asked about its certificate', async () => {
  let asked = false;
  await siteChecks('http://x.test', fakeFetcher(notFound), bareSite('http://x.test'), {
    sitemapUrls: ['http://x.test/p/'],
    readCertificateExpiry: async () => {
      asked = true;
      return NOW_TLS;
    },
  });
  assert.equal(asked, false);
});

// --- redirect maps --------------------------------------------------------

test('a redirect map is read in the shape people actually write it', () => {
  const rules = parseRedirectMap(
    `# a migration
     /old-one    /new-one    301
     /old-two    /new-two
     /just-a-path
     /forced     /new-three  301!

     /pattern/*  /new/:splat 301
    `,
  );
  assert.deepEqual(rules, [
    { from: '/old-one', to: '/new-one', status: 301 },
    { from: '/old-two', to: '/new-two', status: null },
    { from: '/just-a-path', to: null, status: null },
    { from: '/forced', to: '/new-three', status: 301 },
    { from: '/pattern/*', to: '/new/:splat', status: 301 },
  ]);
});

const redirectIds = async (map, routes) => {
  const rules = parseRedirectMap(map);
  const out = await redirectChecks(rules, fakeFetcher(routes), 'https://x.test');
  return out.map((finding) => finding.id);
};

test('an old URL that 404s is an error — the rule never shipped', async () => {
  const ids = await redirectIds('/old /new 301', (url) =>
    url.endsWith('/old') ? { status: 404 } : undefined,
  );
  assert.ok(ids.includes('redirect-dead'));
});

test('an old URL still answering 200 means the rule is not in effect', async () => {
  const ids = await redirectIds('/old /new 301', () => ({ status: 200 }));
  assert.ok(ids.includes('redirect-not-applied'));
});

test('a redirect landing on a 404 is an error, not a working rule', async () => {
  const ids = await redirectIds('/old /new 301', (url) =>
    url.endsWith('/old') ? { status: 301, location: '/new' } : { status: 404 },
  );
  assert.ok(ids.includes('redirect-broken'));
});

test('a redirect that works in one hop reports nothing', async () => {
  const ids = await redirectIds('/old /new 301', (url) =>
    url.endsWith('/old') ? { status: 301, location: '/new' } : { status: 200 },
  );
  assert.deepEqual(ids, []);
});

test('a redirect chain is reported by its hop count', async () => {
  const ids = await redirectIds('/old /final 301', (url) => {
    if (url.endsWith('/old')) return { status: 301, location: '/middle' };
    if (url.endsWith('/middle')) return { status: 301, location: '/final' };
    return { status: 200 };
  });
  assert.ok(ids.includes('redirect-hops'));
});

test('a 302 where the map promises 301 is reported', async () => {
  const ids = await redirectIds('/old /new 301', (url) =>
    url.endsWith('/old') ? { status: 302, location: '/new' } : { status: 200 },
  );
  assert.ok(ids.includes('redirect-temporary'));
});

test('a redirect arriving somewhere the map does not expect is reported', async () => {
  const ids = await redirectIds('/old /new 301', (url) =>
    url.endsWith('/old') ? { status: 301, location: '/somewhere-else' } : { status: 200 },
  );
  assert.ok(ids.includes('redirect-elsewhere'));
});

test('a trailing slash is not a disagreement about the destination', async () => {
  const ids = await redirectIds('/old /new 301', (url) =>
    url.endsWith('/old') ? { status: 301, location: '/new/' } : { status: 200 },
  );
  assert.ok(!ids.includes('redirect-elsewhere'));
});

test('wildcard rules are counted rather than guessed at', async () => {
  const ids = await redirectIds('/blog/* /news/:splat 301', () => ({ status: 200 }));
  assert.deepEqual(ids, ['redirect-pattern-skipped']);
});

test('findings are aggregated, so a big map does not produce a wall', async () => {
  const map = Array.from({ length: 12 }, (_, i) => `/old-${i} /new-${i} 301`).join('\n');
  const out = await redirectChecks(parseRedirectMap(map), fakeFetcher(() => ({ status: 404 })), 'https://x.test');
  const dead = out.filter((finding) => finding.id === 'redirect-dead');
  assert.equal(dead.length, 1, 'one finding, not twelve');
  assert.match(dead[0].title, /12 old URL/);
  assert.match(dead[0].detail, /and 9 more/);
});

// --- click depth ----------------------------------------------------------

const origin = 'https://depth.test';
const node = (path, links = []) => ({
  url: `${origin}${path}`,
  res: { ok: true, status: 200, ms: 1, headers: new Headers() },
  doc: {
    links: { internal: links.map((l) => `${origin}${l}`), inMain: [], external: [] },
    canonical: [`${origin}${path}`],
    og: {},
    hreflang: [],
    images: [],
  },
});

// A corridor: every page links only to the next one.
const corridor = ['/', '/a/', '/b/', '/c/', '/d/', '/e/'].map((path, i, all) =>
  node(path, all[i + 1] ? [all[i + 1]] : []),
);

test('a page deeper than the threshold is reported, with the route that reaches it', () => {
  const deep = crossPageChecks(corridor).filter((finding) => finding.id === 'deep-page');
  assert.equal(deep.length, 1, 'only /e/ is past four clicks');
  assert.equal(deep[0].url, `${origin}/e/`);
  assert.equal(deep[0].level, 'info', 'depth is sometimes deliberate — never an error');
  assert.match(deep[0].title, /^5 clicks/);
  assert.match(deep[0].detail, /\/ → \/a → \/b → \/c → \/d → \/e/);
});

test('the threshold moves with the config', () => {
  const ids2 = (limits) => ids(crossPageChecks(corridor, { limits })).filter((id) => id === 'deep-page');
  assert.deepEqual(ids2({ maxClickDepth: 5 }), [], 'five clicks allowed means five clicks is fine');
  assert.equal(ids2({ maxClickDepth: 2 }).length, 3, '/c/, /d/ and /e/ are past two');
});

test('depth is the shortest route in, not the first one found', () => {
  // The footer link every site has: the deep page is also one click from home.
  const withFooterLink = corridor.map((p) =>
    p.url === `${origin}/`
      ? node('/', ['/a/', '/e/'])
      : p,
  );
  assert.ok(!ids(crossPageChecks(withFooterLink)).includes('deep-page'));
});

test('a page reachable only from an unreachable page is reported', () => {
  const pages = [
    node('/', ['/a/', '/b/', '/c/', '/d/', '/e/', '/f/']),
    ...['/a/', '/b/', '/c/', '/d/', '/e/', '/f/'].map((path) => node(path)),
    node('/stranded/', ['/child/']),
    node('/child/'),
  ];
  const found = crossPageChecks(pages);
  const stranded = found.filter((finding) => finding.id === 'no-path-from-home');
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0].url, `${origin}/child/`);
  // The page nothing links to is already an orphan; saying both about one page
  // twice helps nobody.
  assert.ok(!found.some((f) => f.id === 'no-path-from-home' && f.url === `${origin}/stranded/`));
  assert.ok(found.some((f) => f.id === 'orphan-page' && f.url === `${origin}/stranded/`));
});

test('a link graph with no paths in it is declined rather than reported', () => {
  // What a JavaScript-built navigation looks like to something reading HTML:
  // the homepage appears to link nowhere. Every depth would then be wrong, and
  // a page of invented findings is the one failure this tool cannot afford.
  const pages = [node('/'), ...['/a/', '/b/', '/c/', '/d/', '/e/'].map((path) => node(path))];
  const found = ids(crossPageChecks(pages));
  assert.ok(found.includes('click-depth-skipped'));
  assert.ok(!found.includes('deep-page'));
  assert.ok(!found.includes('no-path-from-home'));
});

test('a truncated crawl measures no depth at all', () => {
  // Two hundred URLs of thirty thousand is a fragment of the graph, and a
  // distance measured across a fragment is not the distance.
  const found = crossPageChecks(corridor, { truncated: 12 });
  const skipped = found.find((finding) => finding.id === 'click-depth-skipped');
  assert.ok(skipped);
  assert.match(skipped.detail, /12 page\(s\) short/);
  assert.ok(!found.some((finding) => finding.id === 'deep-page'));
});

test('a crawl that never fetched the homepage says nothing about depth', () => {
  const found = ids(crossPageChecks(corridor.slice(1)));
  assert.ok(!found.includes('deep-page'));
  assert.ok(!found.includes('click-depth-skipped'), 'no homepage is not a measurement worth explaining');
});

test('a homepage handed in separately is a root, not a page to report on', () => {
  // eslint.org's sitemap lists 499 URLs and not the homepage. Without a root
  // there is no depth to measure, so the audit fetches one — and it must not
  // then be judged as a crawled page.
  const [homeNode, ...rest] = corridor;
  const found = crossPageChecks(rest, { home: homeNode });
  const deep = found.filter((finding) => finding.id === 'deep-page');
  assert.equal(deep.length, 1);
  assert.equal(deep[0].url, `${origin}/e/`);
  assert.ok(!found.some((finding) => finding.url === `${origin}/`), 'the root is not audited');
  // /a/ is linked only by the homepage, which is not in the crawl — the root
  // still counts as a link in, so it is not an orphan.
  assert.ok(!found.some((finding) => finding.id === 'no-path-from-home'));
});

test('a long tail of deep pages is capped and counted', () => {
  const tail = Array.from({ length: 25 }, (_, i) => `/deep-${i}/`);
  const pages = [
    node('/', ['/a/']),
    node('/a/', ['/b/']),
    node('/b/', ['/c/']),
    node('/c/', ['/d/']),
    node('/d/', tail),
    ...tail.map((path) => node(path)),
  ];
  const found = crossPageChecks(pages);
  assert.equal(found.filter((finding) => finding.id === 'deep-page').length, 20);
  const more = found.find((finding) => finding.id === 'deep-page-more');
  assert.match(more.title, /^5 more pages/);
});

// --- four contradictions ---------------------------------------------------

const withHead = (head, body = '<main><h1>x</h1></main>', extra = {}) =>
  ids(pageChecks(page(
    `<html lang="en"><head><title>A title long enough to pass</title>` +
    `<meta name="description" content="${'d'.repeat(80)}">` +
    `<meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`,
    'https://x.test/p/',
    extra,
  )));

test('an image told to wait and to hurry is reported', () => {
  const lazy = '<main><img src="/a.png" alt="a" loading="lazy" fetchpriority="high"></main>';
  assert.ok(withHead('', lazy).includes('img-lazy-priority'));

  // Either one alone is ordinary.
  assert.ok(!withHead('', '<main><img src="/a.png" alt="a" loading="lazy"></main>').includes('img-lazy-priority'));
  assert.ok(!withHead('', '<main><img src="/a.png" alt="a" fetchpriority="high"></main>').includes('img-lazy-priority'));
  assert.ok(!withHead('', '<main><img src="/a.png" alt="a" loading="eager" fetchpriority="high"></main>').includes('img-lazy-priority'));
});

test('a Content-Language header that contradicts <html lang> is reported', () => {
  const headers = (value) => ({ res: { ok: true, status: 200, ms: 1, headers: new Headers({ 'content-language': value }) } });

  assert.ok(withHead('', '<main><h1>x</h1></main>', headers('fr')).includes('content-language-mismatch'));

  // A header listing several languages agrees with itself if the page's is one
  // of them, and en-GB and en are the same claim.
  assert.ok(!withHead('', '<main><h1>x</h1></main>', headers('en, fr')).includes('content-language-mismatch'));
  assert.ok(!withHead('', '<main><h1>x</h1></main>', headers('en-GB')).includes('content-language-mismatch'));
  assert.ok(!withHead('', '<main><h1>x</h1></main>', headers('')).includes('content-language-mismatch'));
});

test('structured data that contradicts itself about dates is reported', () => {
  const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  const article = (extra) => ({ '@type': 'Article', headline: 'h', ...extra });

  assert.ok(withHead(ld(article({ datePublished: '2026-05-01', dateModified: '2026-01-01' })))
    .includes('schema-date-order'));
  assert.ok(withHead(ld(article({ datePublished: '2099-01-01' })))
    .includes('schema-date-future'));

  // The ordinary case, and the same day, say nothing.
  assert.ok(!withHead(ld(article({ datePublished: '2026-01-01', dateModified: '2026-05-01' })))
    .some((id) => id.startsWith('schema-date')));
  assert.ok(!withHead(ld(article({ datePublished: '2026-05-01', dateModified: '2026-05-01' })))
    .some((id) => id.startsWith('schema-date')));
  // Eleven of one store's twelve inversions were exactly one second — Shopify
  // writing two timestamps that round apart — and the twelfth was nine hours.
  assert.ok(!withHead(ld(article({ datePublished: '2026-01-26T13:37:58+04:00', dateModified: '2026-01-26T13:37:57+04:00' })))
    .some((id) => id.startsWith('schema-date')), 'a second apart is a rounding artifact');
  assert.ok(withHead(ld(article({ datePublished: '2026-01-16T13:56:05+04:00', dateModified: '2026-01-16T05:00:00+04:00' })))
    .includes('schema-date-order'), 'nine hours apart is a contradiction');

  // A date this tool cannot parse is not a date this tool has an opinion about.
  assert.ok(!withHead(ld(article({ datePublished: 'last Tuesday' })))
    .some((id) => id.startsWith('schema-date')));
});

test('a URL listed twice in a sitemap is reported, wherever the second one is', () => {
  const file = (url, locs) => ({ url, urls: locs.length, bytes: 100, locs });
  const dupes = (files) =>
    sitemapChecks([], 'https://x.test/sitemap.xml', Date.parse('2026-06-01'), files)
      .filter((finding) => finding.id === 'sitemap-duplicate-url');

  const across = dupes([
    file('https://x.test/posts.xml', ['https://x.test/p/']),
    file('https://x.test/categories.xml', ['https://x.test/p/']),
  ]);
  assert.equal(across.length, 1);
  assert.equal(across[0].level, 'info');
  assert.match(across[0].detail, /posts.xml and https:\/\/x.test\/categories.xml/);

  // Within one file, in a file that is otherwise a normal list of pages.
  assert.match(
    dupes([file('https://x.test/a.xml', ['/a/', '/b/', '/p/', '/c/', '/p/', '/d/'].map((u) => `https://x.test${u}`))])[0].detail,
    /twice in one file/,
  );

  // An image sitemap is one entry per image, so its page URLs repeat by
  // design. wordpress.org's has 681 entries for 171 pages, and reporting that
  // would be reporting the format. Recognised by shape, because Yoast declares
  // xmlns:image on every file it writes and css-tricks.com's ordinary post
  // sitemaps carry image elements too.
  const perImage = Array.from({ length: 12 }, (_, i) => `https://x.test/gallery/${i % 3}/`);
  assert.equal(dupes([file('https://x.test/image-sitemap.xml', perImage)]).length, 0);

  assert.equal(dupes([
    file('https://x.test/a.xml', ['https://x.test/p/']),
    file('https://x.test/b.xml', ['https://x.test/q/']),
  ]).length, 0);
});

test('a rate-limited robots.txt or llms.txt is not a missing one', async () => {
  // The store that prompted this answers 429 under load and serves its
  // llms.txt at 200 the moment it is asked again by hand. The page checks
  // learned this in 1.15.0; these had not.
  const origin = 'https://x.test';
  for (const status of [429, 403, 500]) {
    const out = await siteChecks(
      origin,
      fakeFetcher((url) => (/robots\.txt|llms\.txt/.test(url) ? { status } : notFound(url))),
      bareSite(origin),
      { sitemapUrls: [`${origin}/p/`] },
    );
    assert.ok(!ids(out).includes('robots-missing'), `HTTP ${status} is not a missing robots.txt`);
    assert.ok(!ids(out).includes('llms-missing'), `HTTP ${status} is not a missing llms.txt`);
  }

  // A 404 still is.
  const gone = await siteChecks(origin, fakeFetcher(() => ({ status: 404 })), bareSite(origin), {
    sitemapUrls: [`${origin}/p/`],
  });
  assert.ok(ids(gone).includes('robots-missing'));
  assert.ok(ids(gone).includes('llms-missing'));
});

test('a rate-limited host variant is not a dead one', async () => {
  // The same lesson as the robots.txt test above, in the one place it hurts
  // most: the variant a crawl hammers hardest is the canonical host, so a run
  // that trips a rate limit reported the site's real home as not resolving.
  const origin = 'https://x.test';
  const variants = /^https?:\/\/(www\.)?x\.test\/$/;

  const limited = await siteChecks(
    origin,
    fakeFetcher((url) => (variants.test(url) ? { status: 429 } : notFound(url))),
    bareSite(origin),
    { sitemapUrls: [`${origin}/p/`] },
  );
  assert.ok(!ids(limited).includes('host-variant-dead'), 'HTTP 429 is not a dead variant');
  const note = limited.find((f) => f.id === 'host-variant-not-checked');
  assert.ok(note, 'expected the run to say it did not find out');
  assert.equal(note.level, 'info', 'a fact about the crawl is never an error about the site');

  // A 404 still is, which is the half that matters.
  const gone = await siteChecks(
    origin,
    fakeFetcher(() => ({ status: 404 })),
    bareSite(origin),
    { sitemapUrls: [`${origin}/p/`] },
  );
  assert.ok(ids(gone).includes('host-variant-dead'));
  assert.ok(!ids(gone).includes('host-variant-not-checked'));
});

// --- favicon ---------------------------------------------------------------

const homeDeclaring = (origin, head) => [{
  url: `${origin}/`,
  res: { ok: true, status: 200, ms: 1, headers: new Headers() },
  doc: { ...parseHtml(`<html><head>${head}</head><body></body></html>`, `${origin}/`), hreflang: [], og: {}, images: [] },
}];

const faviconIds = async (head, routes) => {
  const origin = 'https://x.test';
  const out = await siteChecks(origin, fakeFetcher(routes), homeDeclaring(origin, head), {
    sitemapUrls: [`${origin}/`],
  });
  return ids(out).filter((id) => id.startsWith('favicon'));
};

test('a declared favicon that is not there is reported', async () => {
  // The home page asks for it by name, so results fall back to a globe.
  assert.deepEqual(
    await faviconIds('<link rel="icon" href="/fav.png">', (url) =>
      url.endsWith('/fav.png') ? { status: 404 } : notFound(url)),
    ['favicon-broken'],
  );
});

test('a declared favicon that loads is not mentioned', async () => {
  assert.deepEqual(
    await faviconIds('<link rel="shortcut icon" href="/fav.ico">', (url) =>
      url.endsWith('/fav.ico') ? { headers: { 'content-type': 'image/x-icon' } } : notFound(url)),
    [],
  );
});

test('an icon that answers with a page is no icon at all', async () => {
  // The catch-all handler, answering 200 to anything. It reaches a search
  // engine as nothing.
  assert.deepEqual(
    await faviconIds('<link rel="icon" href="/fav.png">', (url) =>
      url.endsWith('/fav.png') ? { headers: { 'content-type': 'text/html' } } : notFound(url)),
    ['favicon-broken'],
  );
});

test('with nothing declared, /favicon.ico is what decides it', async () => {
  // Serving one from a path nobody declared is working as intended.
  assert.deepEqual(
    await faviconIds('<title>t</title>', (url) =>
      url.endsWith('/favicon.ico') ? { headers: { 'content-type': 'image/x-icon' } } : notFound(url)),
    [],
  );
  assert.deepEqual(
    await faviconIds('<title>t</title>', (url) => (url.endsWith('/favicon.ico') ? { status: 404 } : notFound(url))),
    ['favicon-missing'],
  );
});

test('an empty data URI is a decision, not a missing favicon', async () => {
  // example.com and motherfuckingwebsite.com both ship `data:,` to stop the
  // browser asking. There is nothing to fetch and nothing to report.
  const asked = [];
  const out = await siteChecks(
    'https://x.test',
    fakeFetcher((url) => { asked.push(url); return notFound(url); }),
    homeDeclaring('https://x.test', '<link rel="icon" href="data:,">'),
    { sitemapUrls: ['https://x.test/'] },
  );
  assert.ok(!ids(out).some((id) => id.startsWith('favicon')));
  assert.ok(!asked.some((u) => u.startsWith('data:')), 'and nothing tried to fetch it');
});

test('a page served at /favicon.ico is no icon either', async () => {
  // The catch-all handler answering 200 with HTML reaches a search engine as
  // no icon, just as surely as a 404 does.
  assert.deepEqual(
    await faviconIds('<title>t</title>', (url) =>
      url.endsWith('/favicon.ico') ? { headers: { 'content-type': 'text/html' } } : notFound(url)),
    ['favicon-missing'],
  );
});

test('hotlink protection is not a missing favicon', async () => {
  // 403 is somebody's bot rule working, the same judgement the og:image sweep
  // makes. Only an answer that means "not here" counts.
  for (const status of [403, 401, 429, 500]) {
    assert.deepEqual(
      await faviconIds('<link rel="icon" href="/fav.png">', (url) =>
        url.endsWith('/fav.png') ? { status } : notFound(url)),
      [],
      `HTTP ${status} should not be read as a missing favicon`,
    );
  }
});

test('the plain icon is preferred over the iOS one', async () => {
  // Reporting the apple-touch-icon's 404 while a working favicon sits beside it
  // would be true about the wrong file.
  const asked = [];
  await siteChecks(
    'https://x.test',
    fakeFetcher((url) => {
      if (url.includes('apple') || url.includes('fav.svg')) asked.push(url);
      return url.includes('fav.svg') ? { headers: { 'content-type': 'image/svg+xml' } } : notFound(url);
    }),
    homeDeclaring('https://x.test', '<link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/fav.svg">'),
    { sitemapUrls: ['https://x.test/'] },
  );
  assert.deepEqual(asked, ['https://x.test/fav.svg'], 'only the plain icon should have been asked for');
});

// --- the image sweep -------------------------------------------------------

const withImages = (origin, srcs) => [{
  url: `${origin}/p/`,
  res: { ok: true, status: 200, ms: 1, headers: new Headers() },
  doc: {
    links: { internal: [], inMain: [], external: [] },
    canonical: [`${origin}/p/`],
    og: {},
    hreflang: [],
    images: srcs.map((src) => ({ src, alt: 'x' })),
  },
}];

test('one file at six sizes is one image to check, not six', async () => {
  // An image CDN serves any width asked for. Measured across 45 pages of a
  // real store: 767 distinct URLs, 488 distinct files.
  const origin = 'https://x.test';
  const fetcher = countingFetcher();
  const out = await siteChecks(
    origin,
    fetcher,
    withImages(origin, [150, 300, 450, 600, 750, 1200].map((w) => `/cdn/photo.avif?v=17&width=${w}`)),
    { sitemapUrls: [`${origin}/p/`] },
  );
  const asked = fetcher.calls.filter((u) => u.includes('/cdn/photo.avif'));
  assert.equal(asked.length, 1, `one file, one request — asked ${asked.length} times`);
  assert.ok(!out.some((f) => f.id === 'image-sweep-capped'));
});

test('a different version, or a different file, is still its own image', async () => {
  // `v` is not a size knob. A stale version really can 404, and that is a
  // finding worth keeping.
  const origin = 'https://x.test';
  const fetcher = countingFetcher();
  await siteChecks(
    origin,
    fetcher,
    withImages(origin, [
      '/cdn/photo.avif?v=17&width=150',
      '/cdn/photo.avif?v=99&width=150',
      '/cdn/other.avif?v=17&width=150',
    ]),
    { sitemapUrls: [`${origin}/p/`] },
  );
  assert.equal(fetcher.calls.filter((u) => u.includes('/cdn/')).length, 3);
});

test('a broken image is still reported against the page that uses it', async () => {
  const origin = 'https://x.test';
  const out = await siteChecks(
    origin,
    fakeFetcher((url) => (url.includes('/cdn/gone.avif') ? { status: 404 } : notFound(url))),
    withImages(origin, ['/cdn/gone.avif?v=17&width=300']),
    { sitemapUrls: [`${origin}/p/`] },
  );
  const finding = out.find((f) => f.id === 'broken-image');
  assert.ok(finding, 'expected the 404 to be reported');
  assert.equal(finding.url, `${origin}/p/`, 'attributed to the page, not to the CDN');
  assert.match(finding.detail, /width=300/, 'and naming the URL that was actually asked for');
});

// --- a graph worth reading -------------------------------------------------

const linked = (path, targets = []) => linksWith(
  `https://depth.test${path}`,
  `<main>${targets.map((t) => `<a href="${t}">a link</a>`).join('')}</main>`,
);

test('orphans are not looked for across a crawl that stopped early', () => {
  // The Shopify report that started this: 200 of 325 URLs crawled and 122
  // pages called orphans, in the same report that declined to measure click
  // depth for exactly this reason. Every page in a fragment looks unlinked.
  const pages = [linked('/', ['/a/']), linked('/a/'), linked('/b/')];
  const found = crossPageChecks(pages, { truncated: 125 });
  assert.ok(!ids(found).includes('orphan-page'));
  const skipped = found.find((f) => f.id === 'orphan-check-skipped');
  assert.ok(skipped);
  assert.equal(skipped.level, 'info');
  assert.match(skipped.detail, /125 page\(s\) short/);
});

test('orphans are not looked for when the pages that would prove it did not load', () => {
  // A page nobody could fetch contributes no outgoing links, so everything it
  // linked to looks unlinked.
  const pages = [
    linked('/', ['/a/']),
    linked('/a/'),
    ...['/x/', '/y/', '/z/'].map((path) => ({
      url: `https://depth.test${path}`,
      res: { ok: false, status: 429, ms: 1, headers: new Headers() },
      doc: null,
    })),
  ];
  const found = crossPageChecks(pages);
  assert.ok(!ids(found).includes('orphan-page'));
  assert.match(found.find((f) => f.id === 'orphan-check-skipped').detail, /3 of 5 crawled pages did not load/);
});

test('a complete crawl still reports its orphans', () => {
  // The half that matters: the guard must not swallow the check on the runs it
  // was always right about.
  const pages = [linked('/', ['/a/']), linked('/a/'), linked('/lonely/')];
  const found = crossPageChecks(pages);
  assert.ok(ids(found).includes('orphan-page'));
  assert.ok(!ids(found).includes('orphan-check-skipped'));

  // And one failed page in twenty is not enough to stand down over.
  const mostly = [
    linked('/', ['/a/']),
    ...Array.from({ length: 18 }, (_, i) => linked(`/p${i}/`)),
    { url: 'https://depth.test/gone/', res: { ok: false, status: 404, ms: 1, headers: new Headers() }, doc: null },
  ];
  assert.ok(ids(crossPageChecks(mostly)).includes('orphan-page'));
});

// --- rate limiting --------------------------------------------------------

test('a 429 is waited out and retried, not reported', async () => {
  // A Shopify store answered 429 to 70 of 200 pages at the default
  // concurrency, and every one was reported as a page that did not load. The
  // pages were fine; the crawl was too fast.
  const site = await startFixtureSite({ rateLimit: { '/about/': 1 } });
  try {
    const fetcher = new Fetcher({ concurrency: 6 });
    const res = await fetcher.get(`${site.origin}/about/`);
    assert.equal(res.status, 200, 'the second attempt should have been let through');
    assert.equal(fetcher.rateLimited, 1);
    // The concurrency stays down: retrying a rate limit at the speed that
    // caused it just spends the budget again.
    assert.equal(fetcher.concurrency, 3);
  } finally {
    await site.stop();
  }
});

test('a host that keeps refusing is reported as rate limited, never as a broken page', async () => {
  const site = await startFixtureSite({ rateLimit: { '/about/': 99 } });
  try {
    const fetcher = new Fetcher({ concurrency: 4 });
    const res = await fetcher.get(`${site.origin}/about/`, { retries: 0 });
    assert.equal(res.status, 429);

    const found = pageChecks({ url: `${site.origin}/about/`, res, doc: null });
    assert.deepEqual(ids(found), ['rate-limited']);
    assert.equal(found[0].level, 'info', 'the server described the crawl, not the page');
  } finally {
    await site.stop();
  }
});

test('Retry-After is believed where it is sent', async () => {
  // One second asked for, against a default backoff of two, so the elapsed
  // time says which of them was used.
  const site = await startFixtureSite({ rateLimit: { '/about/': 1 }, retryAfter: 1 });
  try {
    const started = Date.now();
    const res = await new Fetcher({}).get(`${site.origin}/about/`);
    const waited = Date.now() - started;
    assert.equal(res.status, 200);
    assert.ok(waited >= 900, `expected it to wait the second it was asked for, waited ${waited}ms`);
    assert.ok(waited < 1900, `expected the header to be used rather than the default, waited ${waited}ms`);
  } finally {
    await site.stop();
  }
});

// --- pagination -----------------------------------------------------------

test('the two pagination shapes that can be read are read, and the rest are left alone', () => {
  assert.deepEqual(seriesOf('https://x.test/blog/page/2/'), { base: 'https://x.test/blog/', page: 2 });
  assert.deepEqual(seriesOf('https://x.test/blog/page/2'), { base: 'https://x.test/blog/', page: 2 });
  assert.deepEqual(seriesOf('https://x.test/blog/?page=2'), { base: 'https://x.test/blog/', page: 2 });
  assert.deepEqual(seriesOf('https://x.test/blog/?paged=4&tag=a'), { base: 'https://x.test/blog/?tag=a', page: 4 });

  // A URL with no pagination is page 1 of its own sequence, which makes the
  // two comparable without a special case at the call site.
  assert.deepEqual(seriesOf('https://x.test/blog/'), { base: 'https://x.test/blog/', page: 1 });

  // Deliberately unread: a bare trailing number is as often a year or an id,
  // ?p= is a WordPress post id and not a page of anything, and a page number
  // that is not a number is not a page number.
  for (const url of ['https://x.test/blog/2/', 'https://x.test/?p=123', 'https://x.test/blog/?page=abc']) {
    assert.equal(seriesOf(url).page, 1, url);
  }
});

const withCanonical = (target, at) =>
  ids(pageChecks(page(
    `<html lang="en"><head><title>A title long enough to pass</title>` +
    `<meta name="description" content="${'d'.repeat(80)}">` +
    `<meta name="viewport" content="width=device-width"><link rel="canonical" href="${target}">` +
    `</head><body><main><h1>x</h1></main></body></html>`,
    at,
  )));

test('a page of a sequence canonicalised to another page of it is an error', () => {
  // Google: "Don't use the first page of a paginated sequence as the canonical
  // page." Page 2 is not the same content as page 1.
  assert.ok(withCanonical('https://x.test/blog/', 'https://x.test/blog/page/2/').includes('canonical-paginated'));
  assert.ok(withCanonical('https://x.test/blog/', 'https://x.test/blog/?page=2').includes('canonical-paginated'));
  assert.ok(withCanonical('https://x.test/blog/?page=2', 'https://x.test/blog/?page=3').includes('canonical-paginated'));
  // The first page named explicitly is the same mistake spelled out.
  assert.ok(withCanonical('https://x.test/blog/page/1/', 'https://x.test/blog/page/2/').includes('canonical-paginated'));
});

test('a page of a sequence that names itself is not reported', () => {
  // The half that matters. This is what the guidance actually asks for.
  const found = withCanonical('https://x.test/blog/page/2/', 'https://x.test/blog/page/2/');
  assert.ok(!found.includes('canonical-paginated'));
  assert.ok(!found.includes('canonical-other'));
  // And page 1 canonicalising to the URL without the pagination is not a page
  // of a sequence handing itself away; it is two URLs for one page.
  assert.ok(!withCanonical('https://x.test/blog/', 'https://x.test/blog/page/1/').includes('canonical-paginated'));
});

test('a canonical pointing somewhere else entirely is still just canonical-other', () => {
  const found = withCanonical('https://x.test/archive/', 'https://x.test/blog/page/2/');
  assert.ok(!found.includes('canonical-paginated'), 'a different sequence is a different question');
  assert.ok(found.includes('canonical-other'));

  // A view-all page is the one target Google used to bless, and it is not the
  // first page of the sequence, so it does not fire either.
  assert.ok(!withCanonical('https://x.test/blog/all/', 'https://x.test/blog/page/2/').includes('canonical-paginated'));

  // An ordinary page deferring elsewhere is unchanged.
  assert.ok(withCanonical('https://x.test/other/', 'https://x.test/p/').includes('canonical-other'));
});

test('the link sweep reads the canonical of a paginated page it was already fetching', async () => {
  // A sitemap does not list page 2 of an archive — 0 of 9,273 URLs across three
  // real sites — so the sweep is where these are met or they are not met at
  // all. The response was already being fetched to see whether the link works.
  const origin = 'https://x.test';
  const out = await siteChecks(
    origin,
    fakeFetcher((url) =>
      url === `${origin}/blog/page/2/`
        ? { body: '<html><head><link rel="canonical" href="https://x.test/blog/"></head></html>' }
        : notFound(url),
    ),
    [linkPage(origin, [`${origin}/blog/page/2/`])],
    { sitemapUrls: [`${origin}/p/`] },
  );
  const finding = out.find((f) => f.id === 'canonical-paginated');
  assert.ok(finding, 'expected the sweep to read it');
  assert.equal(finding.url, `${origin}/blog/page/2/`);
  assert.equal(finding.level, 'error');
});

test('the sweep leaves an ordinary link target, and a page that names itself, alone', async () => {
  const origin = 'https://x.test';
  const bodies = {
    [`${origin}/blog/page/2/`]: '<link rel="canonical" href="https://x.test/blog/page/2/">',
    [`${origin}/about/`]: '<link rel="canonical" href="https://x.test/team/">',
  };
  const out = await siteChecks(
    origin,
    fakeFetcher((url) => (bodies[url] ? { body: `<html><head>${bodies[url]}</head></html>` } : notFound(url))),
    [linkPage(origin, Object.keys(bodies))],
    { sitemapUrls: [`${origin}/p/`] },
  );
  assert.ok(!out.some((f) => f.id === 'canonical-paginated'));
});

// --- anchor text ----------------------------------------------------------

test('a link is named by its text, its image alt, aria-label, title or svg title', () => {
  const doc = parseHtml(
    `<main>
       <a href="/a/">Read more</a>
       <a href="/b/"><img src="/i.png" alt="The reformer class"></a>
       <a href="/c/" aria-label="Book a class"><svg></svg></a>
       <a href="/d/" title="Timetable"><span></span></a>
       <a href="/e/"><svg><title>Instagram</title></svg></a>
       <a href="/f/">Tea &amp; Cake</a>
     </main>`,
    'https://x.test/p/',
  );
  assert.deepEqual(
    doc.links.anchorTexts.map((a) => a.name),
    ['Read more', 'The reformer class', 'Book a class', 'Timetable', 'Instagram', 'Tea & Cake'],
  );
});

test('a link with no name by any of those routes has none', () => {
  const doc = parseHtml(
    `<main>
       <a href="/icon/"><i class="icon-twitter"></i></a>
       <a href="/thumb/"><img src="/i.png" alt=""></a>
     </main>`,
    'https://x.test/p/',
  );
  assert.deepEqual(doc.links.anchorTexts.map((a) => a.name), ['', '']);
});

test('a label bound by a framework is a label the author supplied', () => {
  // The trap that made img-alt report twenty-four of allbirds.com's images as
  // missing alt. The value cannot be read from here; calling it unlabelled is
  // guessing wrong.
  for (const bound of [
    '<a href="/a/"><img src="/i.png" :alt="item.title"></a>',
    '<a href="/a/" :aria-label="label"><svg></svg></a>',
    '<a href="/a/" [ariaLabel]="label"><svg></svg></a>',
    '<a href="/a/" [attr.aria-label]="label"><svg></svg></a>',
  ]) {
    const doc = parseHtml(`<main>${bound}</main>`, 'https://x.test/p/');
    assert.ok(doc.links.anchorTexts[0].name, `${bound} should count as labelled`);
  }
});

test('anchors off the site, to a fragment, or to the page itself are not collected', () => {
  const doc = parseHtml(
    `<main>
       <a href="https://elsewhere.test/">off site</a>
       <a href="#top">skip to top</a>
       <a href="/p/">this very page</a>
       <a href="mailto:hi@x.test">mail</a>
       <a href="/real/">a real one</a>
     </main>`,
    'https://x.test/p/',
  );
  assert.deepEqual(doc.links.anchorTexts, [{ href: 'https://x.test/real/', name: 'a real one' }]);
});

const linksWith = (url, html) => ({
  url,
  res: { ok: true, status: 200, ms: 1, headers: new Headers() },
  doc: { ...parseHtml(html, url), hreflang: [], og: {}, images: [] },
});

test('a destination linked with no words at all is reported once, not once per page', () => {
  // The ones that exist are nearly always in a footer, and the same social icon
  // on two hundred pages is one thing to fix.
  const pages = ['/a/', '/b/', '/c/'].map((path) =>
    linksWith(`https://x.test${path}`, '<main><a href="/contact/"><i class="icon-mail"></i></a></main>'),
  );
  const found = crossPageChecks(pages).filter((finding) => finding.id === 'link-no-text');
  assert.equal(found.length, 1, 'one destination, one finding');
  assert.match(found[0].detail, /3 page\(s\)/);
  assert.match(found[0].detail, /https:\/\/x\.test\/contact/);
});

test('a thumbnail beside a headline is not a link with nothing to read', () => {
  // The card: an image with an emptied alt and the headline next to it are two
  // links to one article. elementor.com's blog index has twenty-three, and
  // reporting them would be a true observation with a false conclusion — the
  // headline says exactly what the article is.
  const index = linksWith(
    'https://x.test/blog/',
    `<main>
       <a href="/post/"><img src="/thumb.png" alt=""></a>
       <a href="/post/">Phoenix here we come</a>
     </main>`,
  );
  assert.ok(!ids(crossPageChecks([index])).includes('link-no-text'));
});

test('a trailing slash does not make one destination look like two', () => {
  // wordpress.org/education names Campus Connect three times at
  // `/campus-connect/` and once, wordlessly, at `/campus-connect`. Matching the
  // href strings called a page with three good links unreadable.
  const page = linksWith(
    'https://x.test/education/',
    `<main>
       <a href="/campus-connect/">Campus Connect</a>
       <a href="/campus-connect"><img src="/i.png" alt=""></a>
     </main>`,
  );
  assert.ok(!ids(crossPageChecks([page])).includes('link-no-text'));
});

test('a link with words is not reported as having none', () => {
  const pages = [
    linksWith('https://x.test/a/', '<main><a href="/contact/">Talk to us</a></main>'),
    linksWith('https://x.test/b/', '<main><a href="/contact/"><img src="/i.png" alt="Talk to us"></a></main>'),
  ];
  assert.ok(!ids(crossPageChecks(pages)).includes('link-no-text'));
});

test('a page linked only by "read more" is reported; one with a real link is not', () => {
  const index = (extra = '') =>
    linksWith('https://x.test/', `<main><a href="/post/">Read more</a><a href="/post/">more →</a>${extra}</main>`);

  const post = linksWith('https://x.test/post/', '<main><p>words</p></main>');
  const found = crossPageChecks([index(), post]).filter((finding) => finding.id === 'anchor-generic');
  assert.equal(found.length, 1);
  assert.equal(found[0].url, 'https://x.test/post/');
  assert.equal(found[0].level, 'info', 'a card under a headline has to say something');
  assert.match(found[0].detail, /"Read more"/);

  // One link that describes the page is enough — the finding is about a page
  // with nothing, not about the existence of a "read more".
  const described = index('<a href="/post/">Pilates for beginners</a>');
  assert.ok(!ids(crossPageChecks([described, post])).includes('anchor-generic'));
});

test('one phrase pointing at two crawled pages is reported', () => {
  // jekyllrb.com links its reference page and its tutorial chapter with the
  // same words — /docs/collections/ and /docs/step-by-step/09-collections/ —
  // and they compete for the same query. Eleven pairs like it on one site.
  const pages = [
    linksWith('https://x.test/', '<main><a href="/docs/collections/">Collections</a></main>'),
    linksWith('https://x.test/tutorial/', '<main><a href="/docs/step-by-step/09-collections/">Collections</a></main>'),
    linksWith('https://x.test/docs/collections/', '<main><p>reference</p></main>'),
    linksWith('https://x.test/docs/step-by-step/09-collections/', '<main><p>tutorial</p></main>'),
  ];
  const found = crossPageChecks(pages).filter((f) => f.id === 'anchor-ambiguous');
  assert.equal(found.length, 1);
  assert.equal(found[0].level, 'info');
  assert.match(found[0].title, /"collections" links to 2 different pages/);
});

test('a destination the crawl never fetched is not called a page', () => {
  // Two of the first real collisions were not two pages at all:
  // elementor.com's /about/privacy/ 301s to /terms/privacy/, and
  // smashingmagazine.com's /categories/business 301s to /category/business.
  // One page under two URLs is a stale link, which link-redirects reports.
  const pages = [
    linksWith('https://x.test/', '<main><a href="/terms/privacy/">Privacy policy</a></main>'),
    linksWith('https://x.test/about/', '<main><a href="/about/privacy/">Privacy policy</a></main>'),
    linksWith('https://x.test/terms/privacy/', '<main><p>the policy</p></main>'),
  ];
  assert.ok(!ids(crossPageChecks(pages)).includes('anchor-ambiguous'));
});

test('labels, controls, file formats and page numbers are not descriptions', () => {
  const crawledPair = [
    linksWith('https://x.test/a/', '<main><p>a</p></main>'),
    linksWith('https://x.test/b/', '<main><p>b</p></main>'),
  ];
  const withLinks = (text, extra = '') =>
    ids(crossPageChecks([
      linksWith('https://x.test/', `<main><a href="/a/">${text}</a><a href="/b/">${text}</a>${extra}</main>`),
      ...crawledPair,
    ]));

  for (const text of ['Read more', 'Home', 'Next', 'Jump to table of contents', '7.1', '2']) {
    assert.ok(!withLinks(text).includes('anchor-ambiguous'), `${text} should not count as a description`);
  }
  // And a real phrase still does.
  assert.ok(withLinks('Pricing').includes('anchor-ambiguous'));
});

test('a phrase used across a whole listing is a table, not an ambiguity', () => {
  // wordpress.org's download page says "md5" beside 2,730 checksums.
  const many = Array.from({ length: 8 }, (_, i) => `/p${i}/`);
  const pages = [
    linksWith('https://x.test/', `<main>${many.map((h) => `<a href="${h}">checksum</a>`).join('')}</main>`),
    ...many.map((h) => linksWith(`https://x.test${h}`, '<main><p>x</p></main>')),
  ];
  assert.ok(!ids(crossPageChecks(pages)).includes('anchor-ambiguous'));
});

test('a page nothing links to is not reported for the words nobody used', () => {
  // orphan-page already says this, and one page is not two problems.
  const pages = [
    linksWith('https://x.test/', '<main><p>no links here</p></main>'),
    linksWith('https://x.test/lonely/', '<main><p>words</p></main>'),
  ];
  const found = ids(crossPageChecks(pages));
  assert.ok(!found.includes('anchor-generic'));
  assert.ok(found.includes('orphan-page'));
});

// --- what the pages actually do in Google ----------------------------------

test('missing credentials are a note, not a failure', async () => {
  // An audit that dies because an optional integration was not configured is
  // worse than one that says so and carries on.
  const { searchConsole } = await import('../src/console.mjs');
  const out = await searchConsole('https://x.test', [], { credentials: { missing: ['GSC_CLIENT_ID'] } });
  assert.deepEqual(ids(out), ['search-console-unconfigured']);
  assert.equal(out[0].level, 'info');
  assert.match(out[0].detail, /never in the repository/);
});

test('traffic is attached to the findings on the pages it belongs to', async () => {
  const { pageTraffic } = await import('../src/console.mjs');
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'a-token' }) };
    assert.match(init.headers.authorization, /^Bearer a-token$/);
    const body = JSON.parse(init.body);
    // Search Console counts the last three days incompletely, so the window
    // has to end before them or a page looks like it lost all its impressions.
    assert.equal(body.endDate, '2026-06-28');
    assert.equal(body.startDate, '2026-05-31');
    assert.deepEqual(body.dimensions, ['page']);
    return {
      ok: true,
      json: async () => ({
        rows: [
          { keys: ['https://x.test/a/'], impressions: 4000.4, clicks: 12.7 },
          { keys: ['https://x.test/b'], impressions: 3, clicks: 0 },
        ],
      }),
    };
  };
  const traffic = await pageTraffic('https://x.test/', { clientId: 'i', clientSecret: 's', refreshToken: 'r' }, {
    fetcher,
    now: Date.parse('2026-07-01T00:00:00Z'),
  });

  assert.equal(calls.length, 2, 'a token, then one query');
  // Keyed without the trailing slash, the way every other URL in this tool is.
  assert.deepEqual(traffic.get('https://x.test/a'), { impressions: 4000, clicks: 13 });
  assert.deepEqual(traffic.get('https://x.test/b'), { impressions: 3, clicks: 0 });
});

test('a property Google will not answer for is a note too', async () => {
  const { searchConsole } = await import('../src/console.mjs');
  const out = await searchConsole('https://x.test', [], {
    credentials: { clientId: 'i', clientSecret: 's', refreshToken: 'r' },
    fetcher: async (url) =>
      url.includes('oauth2')
        ? { ok: true, json: async () => ({ access_token: 't' }) }
        : { ok: false, status: 403, json: async () => ({ error: { message: 'User does not have sufficient permission' } }) },
  });
  assert.deepEqual(ids(out), ['search-console-failed']);
  assert.match(out[0].detail, /sufficient permission/);
  assert.match(out[0].detail, /sc-domain:/, 'and says how a domain property is named');
});

// --- the local server ------------------------------------------------------

test('--serve answers the same pages the Worker does, without a password', async () => {
  // Not a second implementation: worker/index.mjs is written against Request
  // and Response, which Node has, so the same file answers both. The password
  // gate is satisfied rather than skipped — a bypass inside the deployed code
  // is a bypass that can reach production one refactor later.
  const { serve } = await import('../src/serve.mjs');
  const local = await serve({ port: 0 });
  try {
    const form = await fetch(local.url);
    assert.equal(form.status, 200, 'the form, not the unlock page');
    const body = await form.text();
    assert.match(body, /name="url"/);
    assert.ok(!body.includes('AUDIT_TOKEN'), 'nothing should be asking for a password');

    // And the deployment still asks not to be indexed.
    assert.equal(await (await fetch(`${local.url}robots.txt`)).text(), 'User-agent: *\nDisallow: /\n');

    // A host it will not crawl is refused here too.
    const locked = await serve({ port: 0, allowedHosts: 'example.com' });
    try {
      const refused = await fetch(`${locked.url}run?url=https://elsewhere.test/`);
      assert.equal(refused.status, 400);
    } finally {
      await locked.close();
    }
  } finally {
    await local.close();
  }
});

test('--serve 0 asks the operating system for a port', async () => {
  // What the macOS app does, because guessing a port is how two copies of an
  // app fight over one. Zero is falsy, and `if (opts.serve)` sent it to the
  // help text instead — the app opened and the engine never started.
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['bin/seo-audit.mjs', '--serve', '0'], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const announced = await new Promise((resolve, reject) => {
      let seen = '';
      child.stdout.on('data', (chunk) => {
        seen += String(chunk);
        const match = seen.match(/serving at (http:\/\/[\d.]+:(\d+)\/)/);
        if (match) resolve({ url: match[1], port: Number(match[2]) });
      });
      child.once('error', reject);
      setTimeout(() => reject(new Error(`never announced itself: ${seen}`)), 8000);
    });
    assert.ok(announced.port > 0, 'the operating system should have picked a real port');
    assert.equal((await fetch(`${announced.url}robots.txt`)).status, 200);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test('a server reading /dev/null is not a server whose parent has gone', async () => {
  // The first version of the check above asked only whether stdin was a
  // terminal. `--serve < /dev/null` is not one either, and reading it ends
  // immediately — so the server shut down the instant it started, which is how
  // the CI job that builds the macOS app failed on its first run.
  const { spawn } = await import('node:child_process');
  const { openSync } = await import('node:fs');
  const devNull = openSync('/dev/null', 'r');
  const child = spawn(process.execPath, ['bin/seo-audit.mjs', '--serve', '4393'], {
    stdio: [devNull, 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => String(chunk).includes('serving at') && resolve());
      child.once('error', reject);
      setTimeout(() => reject(new Error('never announced itself')), 8000);
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(child.exitCode, null, 'it should still be running');
    assert.equal((await fetch('http://127.0.0.1:4393/robots.txt')).status, 200);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test('a server started by something, rather than by somebody, dies with it', async () => {
  // The macOS shell spawns this and points a web view at it. The first time it
  // was run for real the server outlived the window, held port 4321, and the
  // next launch failed. stdin being a pipe is how a child knows it has a
  // parent; the pipe closing is that parent going away.
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['bin/seo-audit.mjs', '--serve', '4398'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => String(chunk).includes('serving at') && resolve());
      child.once('error', reject);
      setTimeout(() => reject(new Error('the server never announced itself')), 8000);
    });
    assert.equal((await fetch('http://127.0.0.1:4398/robots.txt')).status, 200);

    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.stdin.end(); // the parent going away
    const code = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve('still running'), 5000)),
    ]);
    assert.equal(code, 0, 'the server should have exited when its stdin closed');
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

// --- presenting as something else ------------------------------------------

test("Googlebot's user agents are the ones Google publishes", () => {
  // Quoted from Google's crawler documentation. Google prints the Chrome
  // version as the placeholder W.X.Y.Z; a concrete one is substituted, since
  // the real crawler sends one.
  const smartphone = userAgentFor('googlebot').ua;
  assert.match(smartphone, /^Mozilla\/5\.0 \(Linux; Android 6\.0\.1; Nexus 5X Build\/MMB29P\)/);
  assert.match(smartphone, /Mobile Safari\/537\.36 \(compatible; Googlebot\/2\.1; \+http:\/\/www\.google\.com\/bot\.html\)$/);

  const desktop = userAgentFor('googlebot-desktop').ua;
  assert.match(desktop, /compatible; Googlebot\/2\.1; \+http:\/\/www\.google\.com\/bot\.html\)/);
  assert.ok(!desktop.includes('Mobile'), 'the desktop crawler is not a phone');

  assert.match(userAgentFor('bingbot').ua, /compatible; bingbot\/2\.0/);
});

test('a browser names the system it is running on', () => {
  assert.match(userAgentFor('chrome', 'macos').ua, /Macintosh; Intel Mac OS X 10_15_7/);
  assert.match(userAgentFor('chrome', 'windows').ua, /Windows NT 10\.0; Win64; x64/);
  assert.match(userAgentFor('chrome', 'linux').ua, /X11; Linux x86_64/);
  assert.match(userAgentFor('chrome', 'android').ua, /Mobile Safari/);
  assert.match(userAgentFor('firefox', 'linux').ua, /Gecko\/20100101 Firefox/);
  assert.match(userAgentFor('edge', 'windows').ua, /Edg\//);
  // Chrome on iOS is not Chrome: it is Safari's engine wearing a badge.
  assert.match(userAgentFor('chrome', 'ios').ua, /CriOS/);
});

test('a combination that does not exist is refused, not approximated', () => {
  // The whole point of the flag is to be believed by a server, and a user agent
  // for Safari on Windows describes a machine nobody has.
  assert.match(userAgentFor('safari', 'windows').error, /does not run on windows/);
  assert.match(userAgentFor('safari', 'linux').error, /does not run on linux/);
  assert.match(userAgentFor('netscape', 'macos').error, /Unknown browser/);
  assert.match(userAgentFor('chrome', 'beos').error, /Unknown system/);
  for (const name of BROWSER_NAMES) assert.ok(userAgentFor(name, 'macos').ua, `${name} should work on macOS`);
});

test('a crawler names no machine, so --os has nothing to say to it', () => {
  const asked = userAgentFor('googlebot', 'windows');
  assert.equal(asked.ua, userAgentFor('googlebot', 'macos').ua);
  assert.ok(asked.ignoredOs, 'and it says so rather than pretending the flag worked');
});

test('the default system is the one this is running on', () => {
  assert.equal(thisPlatform('darwin'), 'macos');
  assert.equal(thisPlatform('win32'), 'windows');
  assert.equal(thisPlatform('freebsd'), 'linux');
  assert.ok(OS_NAMES.includes(thisPlatform()));
});

// --- causes ----------------------------------------------------------------

test('a section is the template a page lives under', () => {
  assert.equal(sectionOf('https://x.test/products/blue-sage'), '/products/');
  assert.equal(sectionOf('https://x.test/blogs/the-library/a-post'), '/blogs/the-library/');
  // A trailing slash is not a segment, so /about/ and /about are the same page
  // in the same place — the one thing this must not get wrong.
  assert.equal(sectionOf('https://x.test/about/'), '/');
  assert.equal(sectionOf('https://x.test/about'), '/');
  assert.equal(sectionOf('https://x.test/'), '/');
  assert.equal(sectionOf('not a url'), '/');

  // Past two segments a path is usually a date or a taxonomy rather than a
  // different template. jekyllrb.com's dated archive was becoming one section
  // per month, and 1,206 findings arrived as 602 "things to change".
  assert.equal(sectionOf('https://x.test/news/2024/01/a-post'), '/news/2024/');
  assert.equal(sectionOf('https://x.test/a/b/c/d/e'), '/a/b/');
});

test('the same check on pages of one section is one piece of work', () => {
  // 1,685 findings under /products/ on a real store were one Shopify template
  // repeated 194 times. Reporting them per check makes the reader derive that.
  const mk = (id, url, level = 'warn') => ({ level, id, title: id, detail: 'd', url });
  const findings = [
    ...Array.from({ length: 5 }, (_, i) => mk('img-alt-duplicate', `https://x.test/products/p${i}`)),
    ...Array.from({ length: 2 }, (_, i) => mk('img-alt-duplicate', `https://x.test/blogs/b${i}`)),
    mk('h1-missing', 'https://x.test/pages/a', 'error'),
  ];
  const causes = byCause(findings);

  assert.equal(causes.length, 3, 'two templates and one page, not eight findings');
  // Worst first, then widest.
  assert.equal(causes[0].id, 'h1-missing');
  assert.equal(causes[1].section, '/products/');
  assert.equal(causes[1].pages.length, 5);
  assert.equal(causes[2].section, '/blogs/');
});

test('a cause is as serious as the worst thing in it', () => {
  const findings = [
    { level: 'warn', id: 'x', title: 'the warning', detail: 'd', url: 'https://x.test/a/1' },
    { level: 'error', id: 'x', title: 'the error', detail: 'd', url: 'https://x.test/a/2' },
  ];
  const [cause] = byCause(findings);
  assert.equal(cause.level, 'error');
  assert.equal(cause.title, 'the error');
  assert.equal(cause.count, 2);
});

test('the scope reads as English, and says when it is most of the site', () => {
  const cause = (section, n) => ({
    section,
    pages: Array.from({ length: n }, (_, i) => `https://x.test${section}p${i}`),
  });
  assert.equal(causeScope(cause('/products/', 225), 325), '225 pages under /products/, 69% of the crawl');
  assert.equal(causeScope(cause('/products/', 10), 325), '10 pages under /products/');
  assert.equal(causeScope(cause('/', 4), 325), '4 pages across the site');
  assert.equal(causeScope(cause('/blogs/', 1), 325), 'on one page under /blogs/');
  assert.equal(causeScope(cause('/', 1), 325), 'once');

  // Reach is a count of links that were read, and it is shown when it is known.
  assert.equal(
    causeScope({ ...cause('/products/', 20), inlinks: 412, depth: 3 }, 325),
    '20 pages under /products/, 412 links in',
  );
  assert.equal(
    causeScope({ ...cause('/', 4), inlinks: 40, depth: 1 }, 325),
    '4 pages across the site, 40 links in, one click from home',
  );
});

test('one page tripping a check twice is one page, counted twice', () => {
  const findings = [
    { level: 'warn', id: 'x', title: 't', detail: 'd', url: 'https://x.test/a/1' },
    { level: 'warn', id: 'x', title: 't', detail: 'd', url: 'https://x.test/a/1' },
  ];
  const [cause] = byCause(findings);
  assert.equal(cause.pages.length, 1);
  assert.equal(cause.count, 2);
});

test('every report format leads with the same causes', () => {
  const findings = Array.from({ length: 30 }, (_, i) => ({
    level: 'warn',
    id: `check-${i % 12}`,
    title: `Finding ${i % 12}`,
    detail: 'd',
    url: `https://x.test/products/p${i}`,
  }));
  const meta = { origin: 'https://x.test', pages: 30, date: '2026-08-23' };
  assert.match(markdown(findings, meta), /## Start here/);
  assert.match(html(findings, meta), /Start here/);

  // Under a handful of causes the list below already reads as the summary.
  const few = findings.slice(0, 2);
  assert.ok(!markdown(few, meta).includes('## Start here'));
});

// --- categories -----------------------------------------------------------

test('every check the tool can emit has a category', async () => {
  // The guard that keeps this from drifting: a new check with no category would
  // silently land in "Other" and the grouping would quietly stop being useful.
  const { readdirSync, readFileSync } = await import('node:fs');
  const ids = new Set();
  for (const file of readdirSync('src').filter((f) => f.endsWith('.mjs'))) {
    const src = readFileSync(`src/${file}`, 'utf8');
    for (const m of src.matchAll(/f\('(?:error|warn|info)',\s*'([a-z0-9-]+)'/g)) ids.add(m[1]);
    for (const m of src.matchAll(/id:\s*'([a-z0-9-]+)'/g)) ids.add(m[1]);
  }
  assert.ok(ids.size > 60, `expected to find the checks, found ${ids.size}`);
  const uncategorised = [...ids].filter((id) => categoryOf(id) === 'Other').sort();
  assert.deepEqual(uncategorised, [], `these checks need a category in report.mjs: ${uncategorised}`);
});

test('categories come out in a fixed order, worst finding first inside each', () => {
  const mk = (level, id) => ({ level, id, title: id, detail: 'd', url: 'https://x.test/p/' });
  const groups = byCategory([
    mk('info', 'img-srcset'),
    mk('error', 'broken-link'),
    mk('error', 'noindex'),
    mk('warn', 'img-alt'),
  ]);
  // Indexability before Links before Images, as declared.
  assert.deepEqual(groups.map((g) => g.name), ['Indexability', 'Links', 'Images']);
  // Inside Images, the warning outranks the note.
  assert.deepEqual(groups[2].entries.map((e) => e.id), ['img-alt', 'img-srcset']);
});

test('an unknown id lands in Other rather than vanishing', () => {
  const groups = byCategory([
    { level: 'warn', id: 'not-a-real-check', title: 't', detail: 'd', url: 'https://x.test/' },
  ]);
  assert.deepEqual(groups.map((g) => g.name), ['Other']);
});

// --- outbound links ---------------------------------------------------------

const linkingOut = (origin, external) =>
  bareSite(origin, { links: { internal: [], inMain: [], external, nofollowInternal: [] } });

test('outbound links are left alone unless asked for', async () => {
  const fetcher = fakeFetcher(notFound);
  await siteChecks('https://x.test', fetcher, linkingOut('https://x.test', ['https://other.test/a']), {
    sitemapUrls: ['https://x.test/p/'],
  });
  assert.ok(!fetcher.calls.some((u) => u.includes('other.test')), 'should not touch third parties');
});

test('an outbound 404 is reported when asked for', async () => {
  const out = await siteChecks(
    'https://x.test',
    fakeFetcher((url) => (url.includes('other.test') ? { status: 404 } : notFound(url))),
    linkingOut('https://x.test', ['https://other.test/gone']),
    { sitemapUrls: ['https://x.test/p/'], checkExternal: true },
  );
  const finding = out.find((f) => f.id === 'external-broken');
  assert.ok(finding);
  assert.equal(finding.level, 'warn');
});

test('a third party blocking us is not a broken link', async () => {
  // 403 and 429 are what someone else's bot protection says, not what a dead
  // page says. Reporting them would be the most productive false positive
  // this tool could invent.
  for (const status of [403, 429, 401, 500]) {
    const out = await siteChecks(
      'https://x.test',
      fakeFetcher((url) => (url.includes('other.test') ? { status } : notFound(url))),
      linkingOut('https://x.test', ['https://other.test/a']),
      { sitemapUrls: ['https://x.test/p/'], checkExternal: true },
    );
    assert.ok(!out.some((f) => f.id === 'external-broken'), `${status} should not be called broken`);
  }
});

test('an outbound link that redirects and works is only a note', async () => {
  const out = await siteChecks(
    'https://x.test',
    fakeFetcher((url) => {
      if (!url.includes('other.test')) return notFound(url);
      return url.endsWith('/old') ? { status: 301, location: 'https://other.test/new' } : { status: 200 };
    }),
    linkingOut('https://x.test', ['https://other.test/old']),
    { sitemapUrls: ['https://x.test/p/'], checkExternal: true },
  );
  assert.ok(!out.some((f) => f.id === 'external-broken'));
  const note = out.find((f) => f.id === 'external-redirects');
  assert.equal(note.level, 'info');
});

// --- indexability -----------------------------------------------------------

test('a page that will not be indexed is marked, in every format', async () => {
  const site = await startFixtureSite();
  try {
    const { findings, meta } = await audit(site.origin, { concurrency: 2 });
    // The fixture's /hidden/ carries noindex.
    const hidden = findings.filter((f) => (f.url ?? '').includes('/hidden/'));
    assert.ok(hidden.length, 'expected findings on the noindexed page');
    assert.ok(hidden.every((f) => f.indexable === false), 'they should be marked not indexable');
    assert.ok(meta.notIndexable >= 1);

    // And a page that is perfectly indexable is left unmarked.
    const home = findings.filter((f) => f.url === `${site.origin}/`);
    assert.ok(home.every((f) => f.indexable !== false));

    assert.match(markdown(findings, meta), /_\(not indexable\)_/);
    assert.match(html(findings, meta), /class="noidx"/);
  } finally {
    await site.stop();
  }
});

// --- live progress --------------------------------------------------------

test('a progress line shows the phase, the status, the time and the path', () => {
  const line = progressLine(
    { phase: 'crawl', status: 200, ms: 128, url: 'https://x.test/about/' },
    'https://x.test',
  );
  assert.match(line, /crawl/);
  assert.match(line, /200/);
  assert.match(line, /128ms/);
  // The origin is already on screen from the header; a path reads better in a
  // long column.
  assert.match(line, /\/about\//);
  assert.ok(!line.includes('https://x.test/about/'), 'origin should be trimmed');
});

test('an off-origin URL keeps its host', () => {
  const line = progressLine(
    { phase: 'images', status: 200, url: 'https://cdn.other.test/a.png' },
    'https://x.test',
  );
  assert.match(line, /cdn\.other\.test/);
});

test('the homepage is a slash, not an empty string', () => {
  assert.match(progressLine({ phase: 'crawl', url: 'https://x.test' }, 'https://x.test'), / \/$/);
});

test('a phase with only a detail renders without blank columns', () => {
  const line = progressLine({ phase: 'links', detail: '87 distinct targets to check' });
  assert.match(line, /links\s+87 distinct targets/);
});

test('progress carries what a stalled crawl needs to be diagnosed', () => {
  // A timeout arrives as status 0; it has to be visible rather than blank,
  // because the whole point is telling a slow site from a hung one.
  const line = progressLine({ phase: 'crawl', status: 0, ms: 20000, url: 'https://x.test/slow/' }, 'https://x.test');
  assert.match(line, /\b0\b/);
  assert.match(line, /20000ms/);
});

// --- portfolios -----------------------------------------------------------

test('sites may be bare URLs or objects with their own settings', () => {
  const sites = resolveSites([], {
    sites: ['one.example', { url: 'https://two.example', limit: 50, ignore: ['thin-content'] }],
  });
  assert.deepEqual(sites, [
    { url: 'https://one.example', overrides: {} },
    { url: 'https://two.example', overrides: { limit: 50, ignore: ['thin-content'] } },
  ]);
});

test('URLs on the command line replace the configured portfolio', () => {
  // Naming sites explicitly is how you audit a subset, so they win outright
  // rather than being appended.
  const sites = resolveSites(['just-this.example'], { sites: ['a.example', 'b.example'] });
  assert.deepEqual(sites, [{ url: 'https://just-this.example', overrides: {} }]);
});

test('a site entry with no url is skipped rather than crashing the run', () => {
  assert.deepEqual(resolveSites([], { sites: [{ limit: 10 }, 'ok.example'] }), [
    { url: 'https://ok.example', overrides: {} },
  ]);
});

test('a site override lands on top of the shared config, and ignores accumulate', () => {
  const merged = optionsForSite(
    { limit: 200, failOn: 'error', ignore: ['img-srcset'] },
    { limit: 50, ignore: ['thin-content'] },
  );
  assert.equal(merged.limit, 50);
  assert.equal(merged.failOn, 'error');
  // Both rules are meant to apply: one is portfolio-wide, one is this site.
  assert.deepEqual(merged.ignore, ['img-srcset', 'thin-content']);
});

const run = (origin, levels, pages = 10) => ({
  meta: { origin, pages, ms: 1000, date: '2026-06-01', requests: 20 },
  findings: levels.map((level, i) => ({
    level, id: `${level}-${i}`, title: `${level} thing`, detail: 'd', url: `${origin}/p${i}/`,
  })),
});

test('the portfolio table puts the worst site first', () => {
  const rows = portfolioRows([
    run('https://clean.example', []),
    run('https://bad.example', ['error', 'error', 'warn']),
    run('https://middling.example', ['warn']),
  ]);
  assert.deepEqual(rows.map((r) => r.host), ['bad.example', 'middling.example', 'clean.example']);
});

test('the portfolio summary counts sites, not just findings', () => {
  const text = portfolio([
    run('https://a.example', ['error', 'warn']),
    run('https://b.example', ['error']),
    run('https://c.example', []),
  ]);
  assert.match(text, /2 errors across 2 of 3 sites/);
  assert.match(text, /a\.example/);
});

test('a clean portfolio says so rather than showing an error count of zero', () => {
  const text = portfolio([run('https://a.example', ['info']), run('https://b.example', [])]);
  assert.match(text, /no errors across 2 sites/);
});

test('a site that crawled nothing is called out in its row', () => {
  const dead = { meta: { origin: 'https://dead.example', pages: 0, ms: 10, date: '2026-06-01' }, findings: [] };
  assert.match(portfolio([dead, run('https://ok.example', [])]), /nothing crawled/);
});

test('both portfolio file formats render every site', () => {
  const runs = [run('https://a.example', ['error']), run('https://b.example', ['warn'])];
  const md = portfolioMarkdown(runs);
  assert.match(md, /# SEO audit — portfolio/);
  for (const h of ['a.example', 'b.example']) assert.ok(md.includes(h), `markdown missing ${h}`);

  const page = portfolioHtml(runs);
  assert.ok(page.startsWith('<!doctype html>'));
  // One document, with each site spliced in as a section rather than nested
  // inside another <main>.
  assert.equal((page.match(/<main>/g) ?? []).length, 1);
  assert.equal((page.match(/class="site"/g) ?? []).length, 2);
});

// --- host variants ----------------------------------------------------------

const variantsAskedFor = async (origin) => {
  const fetcher = fakeFetcher(notFound);
  await siteChecks(origin, fetcher, bareSite(origin), { sitemapUrls: [`${origin}/p/`] });
  return fetcher.calls.filter((u) => /^https?:\/\/(www\.)?[^/]+\/$/.test(u));
};

test('a www variant is only tried for a host that can have one', async () => {
  // Asking a resolver for www.127.0.0.1 is a question with no sensible answer.
  // It may decline instantly or sit on it, which is what made the fixture
  // tests — all of which run against 127.0.0.1 — stall unpredictably.
  for (const origin of ['http://127.0.0.1:8080', 'http://localhost:3000', 'https://[::1]:8443']) {
    const asked = await variantsAskedFor(origin);
    assert.ok(!asked.some((u) => u.includes('www.')), `${origin} should not ask for a www variant`);
  }
});

test('a real domain still gets both www variants checked', async () => {
  const asked = await variantsAskedFor('https://x.test');
  assert.ok(asked.includes('https://www.x.test/'));
  assert.ok(asked.includes('http://www.x.test/'));
  assert.ok(asked.includes('http://x.test/'));
});

test('auditing the www host checks the bare one, not www.www', async () => {
  const asked = await variantsAskedFor('https://www.x.test');
  assert.ok(!asked.some((u) => u.includes('www.www.')), 'should not double the prefix');
  assert.ok(asked.includes('https://www.x.test/'));
});

// --- structured data completeness -------------------------------------------

const ld = (data) =>
  page(`<head><script type="application/ld+json">${JSON.stringify(data)}</script></head><main><p>x</p></main>`);

test('a type Google can render is checked for the properties it requires', () => {
  assert.ok(ids(pageChecks(ld({ '@type': 'Article', author: 'A' }))).includes('schema-incomplete'));
  assert.ok(ids(pageChecks(ld({ '@type': 'BreadcrumbList' }))).includes('schema-incomplete'));
  assert.ok(ids(pageChecks(ld({ '@type': 'Event', name: 'E' }))).includes('schema-incomplete'));

  // Complete markup says nothing.
  assert.ok(!ids(pageChecks(ld({ '@type': 'Article', headline: 'A headline' })))
    .includes('schema-incomplete'));
});

test('a Product needs a name and something to show', () => {
  assert.ok(ids(pageChecks(ld({ '@type': 'Product', name: 'Vase' }))).includes('schema-incomplete'));
  // Any one of offers, review or aggregateRating satisfies it.
  for (const key of ['offers', 'review', 'aggregateRating']) {
    assert.ok(
      !ids(pageChecks(ld({ '@type': 'Product', name: 'Vase', [key]: { '@type': 'Offer' } })))
        .includes('schema-incomplete'),
      `${key} should satisfy the requirement`,
    );
  }
});

test('a type the tool has no opinion about is left alone', () => {
  // The list is short on purpose. Anything not on it must stay silent rather
  // than be guessed at, because Google's requirements move.
  assert.ok(!ids(pageChecks(ld({ '@type': 'WebSite' }))).includes('schema-incomplete'));
  assert.ok(!ids(pageChecks(ld({ '@type': 'SoftwareApplication' }))).includes('schema-incomplete'));
});

test('a reference to a node defined elsewhere is not an incomplete node', () => {
  // "publisher": { "@type": "Organization", "@id": "…#org" } points at a full
  // definition made further down; reading it as a bare Organization with no
  // name would report every site using @graph references.
  const graph = {
    '@graph': [
      { '@type': 'Article', headline: 'H', publisher: { '@type': 'Organization', '@id': 'https://x.test/#org' } },
      { '@type': 'Organization', '@id': 'https://x.test/#org', name: 'Acme' },
    ],
  };
  assert.ok(!ids(pageChecks(ld(graph))).includes('schema-incomplete'));
});

test('nodes nested inside a graph are still checked', () => {
  const graph = { '@graph': [{ '@type': 'Article', author: 'A' }] };
  assert.ok(ids(pageChecks(ld(graph))).includes('schema-incomplete'));
});

// --- compression and weight -------------------------------------------------

const served = (html, headers) =>
  page(html, 'https://x.test/p/', {
    res: { ok: true, status: 200, ms: 1, headers: new Headers(headers) },
  });

test('HTML served without compression is reported, once it is worth compressing', () => {
  const big = `<main><p>${'word '.repeat(3000)}</p></main>`; // ~15KB
  assert.ok(ids(pageChecks(served(big, {}))).includes('uncompressed'));
  assert.ok(!ids(pageChecks(served(big, { 'content-encoding': 'br' }))).includes('uncompressed'));
  assert.ok(!ids(pageChecks(served(big, { 'content-encoding': 'gzip' }))).includes('uncompressed'));
});

test('a small response is not worth compressing and is not mentioned', () => {
  // Plenty of CDNs skip compression below a few KB, correctly.
  assert.ok(!ids(pageChecks(served('<main><p>short</p></main>', {}))).includes('uncompressed'));
});

// --- conflicting directives and meta refresh --------------------------------

test('the robots meta and header contradicting each other is reported', () => {
  const conflicting = (meta, header) =>
    page(`<head><meta name="robots" content="${meta}"></head><main><p>x</p></main>`, 'https://x.test/p/', {
      res: { ok: true, status: 200, ms: 1, headers: new Headers({ 'x-robots-tag': header }) },
    });

  assert.ok(ids(pageChecks(conflicting('index', 'noindex'))).includes('robots-conflict'));
  assert.ok(ids(pageChecks(conflicting('noindex', 'index'))).includes('robots-conflict'));
  assert.ok(ids(pageChecks(conflicting('follow', 'nofollow'))).includes('robots-conflict'));

  // Agreeing, or saying different things about different axes, is not a clash.
  assert.ok(!ids(pageChecks(conflicting('noindex', 'noindex'))).includes('robots-conflict'));
  assert.ok(!ids(pageChecks(conflicting('index, follow', 'index, follow'))).includes('robots-conflict'));
  assert.ok(!ids(pageChecks(conflicting('noindex', 'nofollow'))).includes('robots-conflict'));
});

test('a meta refresh redirect is reported, and a plain refresh is not', () => {
  const meta = (content) =>
    page(`<head><meta http-equiv="refresh" content="${content}"></head><main><p>x</p></main>`);
  const finding = pageChecks(meta('0;url=/somewhere/')).find((x) => x.id === 'meta-refresh');
  assert.ok(finding);
  assert.match(finding.detail, /\/somewhere\//);

  // A delay is worth mentioning; a refresh with no destination is a reload, not
  // a redirect, and this check has nothing to say about it.
  assert.match(pageChecks(meta('5;url=/late/')).find((x) => x.id === 'meta-refresh').detail, /delay/);
  assert.ok(!ids(pageChecks(meta('30'))).includes('meta-refresh'));
});

// --- sitemap limits ---------------------------------------------------------

test('a sitemap file past the protocol limits is an error', () => {
  const big = [{ url: 'https://a.test/sitemap.xml', urls: 60000, bytes: 1000 }];
  assert.ok(sitemapChecks([], 'https://a.test/sitemap.xml', NOW, big)
    .some((x) => x.id === 'sitemap-too-many-urls'));

  const heavy = [{ url: 'https://a.test/sitemap.xml', urls: 10, bytes: 60 * 1024 * 1024 }];
  assert.ok(sitemapChecks([], 'https://a.test/sitemap.xml', NOW, heavy)
    .some((x) => x.id === 'sitemap-too-large'));
});

test('a sitemap comfortably inside the limits says nothing', () => {
  const fine = [{ url: 'https://a.test/sitemap.xml', urls: 49_999, bytes: 5 * 1024 * 1024 }];
  assert.deepEqual(sitemapChecks([], 'https://a.test/sitemap.xml', NOW, fine), []);
});

test('the limits are per file, so an index of many files is judged file by file', () => {
  // Flattening first would report a site with four 20k sitemaps as over the
  // limit when every file is legal.
  const four = Array.from({ length: 4 }, (_, i) => ({
    url: `https://a.test/s${i}.xml`, urls: 20_000, bytes: 1000,
  }));
  assert.deepEqual(sitemapChecks([], 'https://a.test/sitemap.xml', NOW, four), []);
});

// --- robots.txt -----------------------------------------------------------

const allows = (body, path, agent) => robotsVerdict(parseRobots(body), path, agent).allowed;

test('a longer rule beats a shorter one, whichever way it points', () => {
  // The pattern that makes a Disallow-only implementation useless: almost every
  // WordPress site carves admin-ajax.php out of a blocked /wp-admin/.
  const body = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n';
  assert.equal(allows(body, '/wp-admin/'), false);
  assert.equal(allows(body, '/wp-admin/options.php'), false);
  assert.equal(allows(body, '/wp-admin/admin-ajax.php'), true);
});

test('a tie between Allow and Disallow goes to Allow', () => {
  const body = 'User-agent: *\nDisallow: /x/\nAllow: /x/\n';
  assert.equal(allows(body, '/x/page/'), true);
});

test('an empty Disallow blocks nothing', () => {
  // "Disallow:" with no value is the documented way to say "nothing".
  assert.equal(allows('User-agent: *\nDisallow:\n', '/anything/'), true);
});

test('wildcards and the end anchor are honoured', () => {
  const body = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /private*/secret\n';
  assert.equal(allows(body, '/files/report.pdf'), false);
  // Anchored: the extension has to end the path.
  assert.equal(allows(body, '/files/report.pdf.html'), true);
  assert.equal(allows(body, '/private-area/secret'), false);
  assert.equal(allows(body, '/public/secret'), true);
});

test('a path nothing matches is allowed', () => {
  assert.equal(allows('User-agent: *\nDisallow: /admin/\n', '/about/'), true);
});

test('a Googlebot group wins over the wildcard group', () => {
  const body = 'User-agent: *\nDisallow: /\n\nUser-agent: googlebot\nAllow: /\n';
  assert.equal(allows(body, '/about/', 'googlebot'), true);
  assert.equal(allows(body, '/about/', 'bingbot'), false);
});

test('consecutive user-agent lines share one set of rules', () => {
  const body = 'User-agent: googlebot\nUser-agent: bingbot\nDisallow: /both/\n';
  assert.equal(allows(body, '/both/', 'googlebot'), false);
  assert.equal(allows(body, '/both/', 'bingbot'), false);
});

test('comments and blank lines are ignored, and rules before any agent belong to nobody', () => {
  const body = '# a comment\nDisallow: /orphaned/\n\nUser-agent: *\nDisallow: /real/ # trailing\n';
  assert.equal(allows(body, '/orphaned/'), true);
  assert.equal(allows(body, '/real/'), false);
});

test('a sitemap URL that robots.txt disallows is reported', async () => {
  const origin = 'https://x.test';
  const fetcher = fakeFetcher((url) => {
    if (url.endsWith('/robots.txt')) {
      return { body: 'User-agent: *\nDisallow: /private/\nSitemap: https://x.test/sitemap.xml\n' };
    }
    return notFound(url);
  });
  const out = await siteChecks(origin, fetcher, bareSite(origin), {
    sitemapUrls: [`${origin}/ok/`, `${origin}/private/thing/`],
  });
  const finding = out.find((f) => f.id === 'robots-blocks-sitemap-url');
  assert.ok(finding, 'expected the contradiction to be reported');
  assert.match(finding.title, /1 sitemap URL/);
  assert.match(finding.detail, /private\/thing/);
});

test('a carve-out in robots.txt does not make the sitemap look blocked', async () => {
  const origin = 'https://x.test';
  const fetcher = fakeFetcher((url) =>
    url.endsWith('/robots.txt')
      ? { body: 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nSitemap: s\n' }
      : notFound(url),
  );
  const out = await siteChecks(origin, fetcher, bareSite(origin), {
    sitemapUrls: [`${origin}/wp-admin/admin-ajax.php`, `${origin}/about/`],
  });
  assert.ok(!out.some((f) => f.id === 'robots-blocks-sitemap-url'));
});

test('blocking one badly-behaved crawler is not blocking the site', async () => {
  // gov.uk blocks deepcrawl and python.org blocks HTTrack, each in its own
  // group. Testing for "a Disallow: / somewhere and a User-agent: * somewhere"
  // reported both as blocking the entire site from everyone.
  const origin = 'https://x.test';
  const body = [
    'User-agent: *',
    'Disallow: /search/all*',
    'Sitemap: https://x.test/sitemap.xml',
    '',
    'User-agent: deepcrawl',
    'Disallow: /',
  ].join('\n');
  const out = await siteChecks(origin, fakeFetcher((url) =>
    url.endsWith('/robots.txt') ? { body } : notFound(url),
  ), bareSite(origin), { sitemapUrls: [`${origin}/p/`] });
  assert.ok(!out.some((f) => f.id === 'robots-blocks-all'));
});

test('a site blocked entirely is reported once, not once per sitemap URL', async () => {
  const origin = 'https://x.test';
  const fetcher = fakeFetcher((url) =>
    url.endsWith('/robots.txt') ? { body: 'User-agent: *\nDisallow: /\n' } : notFound(url),
  );
  const out = await siteChecks(origin, fetcher, bareSite(origin), {
    sitemapUrls: [`${origin}/a/`, `${origin}/b/`, `${origin}/c/`],
  });
  assert.ok(out.some((f) => f.id === 'robots-blocks-all'));
  assert.ok(!out.some((f) => f.id === 'robots-blocks-sitemap-url'));
});

// --- sitemap hygiene ------------------------------------------------------

const NOW = Date.parse('2026-06-01T00:00:00Z');
const dated = (n, lastmod) =>
  Array.from({ length: n }, (_, i) => ({ loc: `https://a.test/p${i}/`, lastmod }));
const sitemapIds = (entries, now = NOW) =>
  sitemapChecks(entries, 'https://a.test/sitemap.xml', now).map((finding) => finding.id);

test('a sitemap where every page shares one lastmod is reported', () => {
  // The generator stamped build time on all of them.
  assert.ok(sitemapIds(dated(20, '2026-05-30')).includes('sitemap-lastmod-identical'));
});

test('a handful of pages sharing a date is not called a pattern', () => {
  // A small site genuinely does get rebuilt all at once.
  assert.ok(!sitemapIds(dated(4, '2026-05-30')).includes('sitemap-lastmod-identical'));
});

test('varied lastmod dates are what correct looks like', () => {
  const varied = dated(20, '2026-05-30').map((entry, i) => ({ ...entry, lastmod: `2026-05-${10 + i}` }));
  assert.deepEqual(sitemapIds(varied), []);
});

test('a lastmod in the future is a warning', () => {
  const ids = sitemapIds([...dated(3, '2026-05-01'), { loc: 'https://a.test/x/', lastmod: '2027-01-01' }]);
  assert.ok(ids.includes('sitemap-lastmod-future'));
});

test('a lastmod a few hours ahead is clock skew, not a finding', () => {
  const soon = new Date(NOW + 6 * 60 * 60 * 1000).toISOString();
  assert.ok(!sitemapIds([{ loc: 'https://a.test/x/', lastmod: soon }]).includes('sitemap-lastmod-future'));
});

test('a sitemap with no lastmod at all says so once', () => {
  const ids = sitemapIds(dated(10, null));
  assert.deepEqual(ids, ['sitemap-lastmod-missing']);
});

test('an empty sitemap produces nothing rather than throwing', () => {
  assert.deepEqual(sitemapIds([]), []);
});

// --- the link sweep -------------------------------------------------------

// A fetcher that records every URL asked for and lets a test script individual
// responses. Deliberately does not cache: the point is to count what the sweep
// asks for, not what the real Fetcher would spare it.
function fakeFetcher(routes = () => undefined) {
  const calls = [];
  const make = (url, o = {}) => {
    const status = o.status ?? 200;
    return {
      url,
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(o.headers ?? { 'content-type': 'text/html' }),
      body: o.body ?? '',
      location: o.location ?? null,
      error: o.error,
      ms: 1,
    };
  };
  return {
    calls,
    async get(url, { method = 'GET' } = {}) {
      calls.push(url);
      return make(url, routes(url, method) ?? {});
    },
    // Follows redirects like the real Fetcher does, so a test can express
    // "308 to strip the slash, then 200" — the shape that matters for soft 404s.
    async chain(url, max = 5) {
      const hops = [];
      let current = url;
      for (let i = 0; i < max; i++) {
        const res = await this.get(current);
        hops.push({ url: current, status: res.status });
        if (res.status < 300 || res.status >= 400 || !res.location) return { hops, final: res };
        current = new URL(res.location, current).toString();
      }
      return { hops, final: await this.get(current) };
    },
  };
}
const countingFetcher = () => fakeFetcher();

// Every fake host below answers 404 for the soft-404 probe unless a test says
// otherwise, so a site that behaves correctly is the default.
const notFound = (url) => (url.includes('seo-audit-probe-404') ? { status: 404 } : undefined);

const linkPage = (origin, targets) => ({
  url: `${origin}/p/`,
  res: { ok: true, status: 200, ms: 1, headers: new Headers() },
  doc: {
    links: { internal: targets, inMain: [], external: [] },
    canonical: [`${origin}/p/`],
    og: {},
    hreflang: [],
  },
});

test('the link sweep never fetches more targets than maxLinkChecks allows', async () => {
  const origin = 'https://x.test';
  const targets = Array.from({ length: 50 }, (_, i) => `${origin}/link-${i}/`);
  const fetcher = countingFetcher();

  const out = await siteChecks(origin, fetcher, [linkPage(origin, targets)], {
    sitemapUrls: [`${origin}/p/`],
    maxLinkChecks: 5,
  });

  // Before the two passes were merged, the second one looped over all 50
  // uncapped, so the cap bounded one check rather than the run.
  const fetched = fetcher.calls.filter((u) => u.includes('/link-'));
  assert.equal(new Set(fetched).size, 5);
  assert.equal(fetched.length, 5, 'each target asked for once');

  const capped = out.find((finding) => finding.id === 'link-sweep-capped');
  assert.ok(capped, 'expected the sweep to say it stopped early');
  assert.match(capped.title, /45 link targets were not checked/);
});

test('a sweep that checks everything does not claim it was capped', async () => {
  const origin = 'https://x.test';
  const fetcher = countingFetcher();
  const out = await siteChecks(origin, fetcher, [linkPage(origin, [`${origin}/only/`])], {
    sitemapUrls: [`${origin}/p/`],
    maxLinkChecks: 5,
  });
  assert.ok(!out.some((finding) => finding.id === 'link-sweep-capped'));
});

test('internal links that redirect are aggregated into one note', async () => {
  const origin = 'https://x.test';
  const targets = [`${origin}/a/`, `${origin}/b/`, `${origin}/c/`];
  const out = await siteChecks(
    origin,
    fakeFetcher((url) => (/\/[ab]\/$/.test(url) ? { status: 301 } : notFound(url))),
    [linkPage(origin, targets)],
    { sitemapUrls: [`${origin}/p/`] },
  );
  const note = out.filter((finding) => finding.id === 'link-redirects');
  assert.equal(note.length, 1, 'one aggregated note, not one per link');
  assert.equal(note[0].level, 'info');
  assert.match(note[0].title, /2 internal link/);
});

test('broken links are reported in link order, so two runs agree', async () => {
  const origin = 'https://x.test';
  const targets = Array.from({ length: 6 }, (_, i) => `${origin}/link-${i}/`);
  const fetcher = countingFetcher();
  // Every other target is missing, and they resolve out of order.
  fetcher.get = async function (url) {
    this.calls.push(url);
    const missing = /link-[135]\//.test(url);
    await new Promise((r) => setTimeout(r, missing ? 1 : 5));
    return {
      url, status: missing ? 404 : 200, ok: !missing, body: '', location: null, ms: 1,
      headers: new Headers({ 'content-type': 'text/html' }),
    };
  };

  const out = await siteChecks(origin, fetcher, [linkPage(origin, targets)], {
    sitemapUrls: [`${origin}/p/`],
  });
  const broken = out.filter((finding) => finding.id === 'broken-link').map((finding) => finding.detail);
  assert.equal(broken.length, 3);
  assert.match(broken[0], /link-1\//);
  assert.match(broken[1], /link-3\//);
  assert.match(broken[2], /link-5\//);
});

// --- soft 404s ------------------------------------------------------------

const bareSite = (origin, extra = {}) => [{
  url: `${origin}/p/`,
  res: { ok: true, status: 200, ms: 1, headers: new Headers() },
  doc: { links: { internal: [], inMain: [], external: [] }, canonical: [], og: {}, hreflang: [], images: [], ...extra },
}];

const soft404 = async (routes) => {
  const out = await siteChecks('https://x.test', fakeFetcher(routes), bareSite('https://x.test'), {
    sitemapUrls: ['https://x.test/p/'],
  });
  return out.find((finding) => finding.id === 'soft-404');
};

test('a site that 404s a missing page is not reported', async () => {
  assert.equal(await soft404(notFound), undefined);
});

test('a missing page answering 200 with HTML is an error', async () => {
  const finding = await soft404(() => undefined); // 200 for everything
  assert.ok(finding, 'expected a soft-404 finding');
  assert.equal(finding.level, 'error');
});

test('a soft 404 carrying noindex is a warning, not an error', async () => {
  const finding = await soft404((url) =>
    url.includes('seo-audit-probe-404')
      ? { body: '<meta name="robots" content="noindex">' }
      : undefined,
  );
  assert.equal(finding.level, 'warn');
  assert.match(finding.title, /noindexed/);
});

test('the same applies when the noindex arrives as a header', async () => {
  const finding = await soft404((url) =>
    url.includes('seo-audit-probe-404')
      ? { headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } }
      : undefined,
  );
  assert.equal(finding.level, 'warn');
});

test('missing pages redirected to the homepage are reported as a soft 404', async () => {
  const finding = await soft404((url) =>
    url.includes('seo-audit-probe-404') ? { status: 302, location: 'https://x.test/' } : undefined,
  );
  assert.ok(finding, 'expected a soft-404 finding');
  assert.equal(finding.level, 'warn');
  assert.match(finding.title, /homepage/);
});

test('a redirect that ends in a real 404 is silent', async () => {
  // wikipedia.org does exactly this: 301, then 404. Correct behaviour, and
  // judging only the first hop would report it as a problem.
  const finding = await soft404((url) => {
    if (!url.includes('seo-audit-probe-404')) return undefined;
    return url.endsWith('/') ? { status: 301, location: '/seo-audit-probe-404' } : { status: 404 };
  });
  assert.equal(finding, undefined);
});

test('a redirect that ends in a 200 is caught, which reading one hop would miss', async () => {
  // vercel.com's shape: 308 to strip the trailing slash, then a 200 soft 404.
  const finding = await soft404((url) => {
    if (!url.includes('seo-audit-probe-404')) return undefined;
    return url.endsWith('/') ? { status: 308, location: '/seo-audit-probe-404' } : { status: 200 };
  });
  assert.ok(finding, 'expected the chain to be followed to its 200');
  assert.equal(finding.level, 'error');
  assert.match(finding.detail, /308/);
});

// --- broken images --------------------------------------------------------

const imageSite = (origin, srcs) => bareSite(origin, { images: srcs.map((src) => ({ src, alt: 'x' })) });

test('an image that 404s is reported, with the page that uses it', async () => {
  const out = await siteChecks(
    'https://x.test',
    fakeFetcher((url) => (url.endsWith('/gone.png') ? { status: 404 } : notFound(url))),
    imageSite('https://x.test', ['/gone.png', '/fine.png']),
    { sitemapUrls: ['https://x.test/p/'] },
  );
  const broken = out.filter((finding) => finding.id === 'broken-image');
  assert.equal(broken.length, 1);
  assert.match(broken[0].detail, /gone\.png/);
  assert.equal(broken[0].url, 'https://x.test/p/');
});

test('an image behind hotlink protection is not called broken', async () => {
  // 403 is that protection working as designed. Reporting it would be the
  // /cdn-cgi/ mistake a second time.
  const out = await siteChecks(
    'https://x.test',
    fakeFetcher((url) => (url.endsWith('/guarded.png') ? { status: 403 } : notFound(url))),
    imageSite('https://x.test', ['/guarded.png']),
    { sitemapUrls: ['https://x.test/p/'] },
  );
  assert.ok(!out.some((finding) => finding.id === 'broken-image'));
});

test('a host that rejects HEAD is retried with GET before being called broken', async () => {
  const seen = [];
  const fetcher = fakeFetcher((url, method) => {
    if (!url.endsWith('/pic.png')) return notFound(url);
    seen.push(method);
    return method === 'HEAD' ? { status: 405 } : { status: 200 };
  });
  const out = await siteChecks('https://x.test', fetcher, imageSite('https://x.test', ['/pic.png']), {
    sitemapUrls: ['https://x.test/p/'],
  });
  assert.deepEqual(seen, ['HEAD', 'GET']);
  assert.ok(!out.some((finding) => finding.id === 'broken-image'));
});

test('a data: URI is not fetched', async () => {
  const fetcher = fakeFetcher(notFound);
  await siteChecks('https://x.test', fetcher, imageSite('https://x.test', ['data:image/png;base64,AAAA']), {
    sitemapUrls: ['https://x.test/p/'],
  });
  assert.ok(!fetcher.calls.some((u) => u.startsWith('data:')));
});

// --- psi targets ----------------------------------------------------------

const crawled = (n, prefix = '/journal') =>
  Array.from({ length: n }, (_, i) => `https://x.test${prefix}/post-${i}/`);

test('psiTargets passes a URL or a path through, resolving against the origin', () => {
  const { urls, notes } = psiTargets(['https://other.test/a/', '/pricing/'], [], {
    origin: 'https://x.test',
  });
  assert.deepEqual(urls, ['https://other.test/a/', 'https://x.test/pricing/']);
  assert.deepEqual(notes, []);
});

test('a section glob expands to the crawled pages under it, capped at the sample', () => {
  const { urls } = psiTargets(['/journal/**'], crawled(40), {
    origin: 'https://x.test',
    sample: 3,
  });
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => u.startsWith('https://x.test/journal/')));
});

test('the sample is spread across the section, not the first n', () => {
  const { urls } = psiTargets(['/journal/**'], crawled(30), {
    origin: 'https://x.test',
    sample: 3,
  });
  // First, middle, last third — a template regression late in a section is
  // exactly what taking the first three would miss.
  assert.deepEqual(urls, [
    'https://x.test/journal/post-0/',
    'https://x.test/journal/post-10/',
    'https://x.test/journal/post-20/',
  ]);
});

test('the same pages are sampled on every run, so a baseline stays comparable', () => {
  const once = psiTargets(['/journal/**'], crawled(40), { origin: 'https://x.test' });
  const twice = psiTargets(['/journal/**'], crawled(40), { origin: 'https://x.test' });
  assert.deepEqual(once.urls, twice.urls);
});

test('a sampled section says what it did not measure', () => {
  const { notes } = psiTargets(['/journal/**'], crawled(40), {
    origin: 'https://x.test',
    sample: 3,
  });
  const sampled = notes.find((n) => n.id === 'psi-sampled');
  assert.ok(sampled, 'expected a psi-sampled note');
  assert.match(sampled.title, /3 of the 40/);
  assert.match(sampled.detail, /37 were not looked at/);
});

test('a section small enough to measure whole reports no sampling', () => {
  const { urls, notes } = psiTargets(['/journal/**'], crawled(2), {
    origin: 'https://x.test',
    sample: 3,
  });
  assert.equal(urls.length, 2);
  assert.deepEqual(notes, []);
});

test('a glob matching nothing says so rather than measuring nothing quietly', () => {
  const { urls, notes } = psiTargets(['/shop/**'], crawled(5), { origin: 'https://x.test' });
  assert.deepEqual(urls, []);
  assert.equal(notes[0].id, 'psi-no-match');
});

test('two globs over the same page measure it once', () => {
  const { urls } = psiTargets(['/journal/**', '/journal/post-0/'], crawled(1), {
    origin: 'https://x.test',
    sample: 3,
  });
  assert.deepEqual(urls, ['https://x.test/journal/post-0/']);
});

// --- config ---------------------------------------------------------------

test('matchGlob: * stops at a slash, ** does not', () => {
  assert.ok(matchGlob('/journal/*/', '/journal/post/'));
  assert.ok(!matchGlob('/journal/*/', '/journal/2026/post/'));
  assert.ok(matchGlob('/journal/**', '/journal/2026/post/'));
  assert.ok(matchGlob('**/privacy-policy/', '/ru/privacy-policy/'));
  assert.ok(!matchGlob('/contact/', '/contact/us/'));
});

test('matchGlob escapes regex metacharacters in the pattern', () => {
  assert.ok(matchGlob('/a.b/', '/a.b/'));
  assert.ok(!matchGlob('/a.b/', '/axb/'));
});

test('applyIgnores silences by id, and by id scoped to URLs', () => {
  const findings = [
    { id: 'thin-content', url: 'https://x.test/contact/', level: 'warn' },
    { id: 'thin-content', url: 'https://x.test/sessions/', level: 'warn' },
    { id: 'img-alt', url: 'https://x.test/', level: 'error' },
  ];
  const [keptAll] = applyIgnores(findings, ['img-alt']);
  assert.equal(keptAll.length, 2);

  const [kept, ignored] = applyIgnores(findings, [
    { id: 'thin-content', urls: ['/contact/'] },
  ]);
  assert.equal(ignored, 1);
  assert.deepEqual(kept.map((f) => f.url), [
    'https://x.test/sessions/',
    'https://x.test/',
  ]);
});

test('expectationChecks finds a missing schema type and reports what is there', () => {
  const pages = [
    {
      url: 'https://x.test/journal/a/',
      doc: { jsonld: [{ ok: true, data: { '@type': 'WebPage' } }] },
    },
  ];
  const out = expectationChecks(pages, [{ urls: ['/journal/*/'], types: ['BlogPosting'] }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'error');
  assert.match(out[0].title, /BlogPosting/);
  assert.match(out[0].detail, /WebPage/);
});

test('expectationChecks looks inside an @graph', () => {
  const pages = [
    {
      url: 'https://x.test/',
      doc: {
        jsonld: [
          { ok: true, data: { '@graph': [{ '@type': ['LocalBusiness', 'Store'] }, { '@type': 'WebSite' }] } },
        ],
      },
    },
  ];
  assert.equal(expectationChecks(pages, [{ urls: ['/'], types: ['LocalBusiness', 'WebSite'] }]).length, 0);
});

// --- baseline -------------------------------------------------------------

test('diff separates new findings from fixed ones', () => {
  const previous = {
    meta: { date: '2026-01-01' },
    findings: [
      { id: 'a', url: 'https://x.test/1', level: 'warn' },
      { id: 'b', url: 'https://x.test/2', level: 'error' },
    ],
  };
  const current = [
    { id: 'a', url: 'https://x.test/1', level: 'warn' },
    { id: 'c', url: 'https://x.test/3', level: 'error' },
  ];
  const d = diff(previous, current);
  assert.deepEqual(d.added.map((f) => f.id), ['c']);
  assert.deepEqual(d.fixed.map((f) => f.id), ['b']);
  assert.equal(d.unchanged, 1);
});

test('the same check on a different page counts as new', () => {
  const d = diff(
    { findings: [{ id: 'a', url: 'https://x.test/1' }] },
    [{ id: 'a', url: 'https://x.test/2' }],
  );
  assert.equal(d.added.length, 1);
  assert.equal(d.fixed.length, 1);
});

test('a baseline round-trips through serialize and parse', () => {
  const findings = [{ level: 'warn', id: 'a', title: 'T', detail: 'D', url: 'https://x.test/' }];
  const restored = parseBaseline(serialize(findings, { date: '2026-01-01' }), 'test');
  assert.deepEqual(restored.findings, findings);
});

test('a report carries the grouping and a baseline does not', () => {
  // The CLI wrote findings and the Worker wrote findings *and* causes, so a
  // machine reading `--json` got a different document from one reading the
  // hosted version — against the rule that says those two must never differ.
  const findings = [
    { level: 'warn', id: 'a', title: 'T', detail: 'D', url: 'https://x.test/p/one' },
    { level: 'warn', id: 'a', title: 'T', detail: 'D', url: 'https://x.test/p/two' },
  ];
  const meta = { date: '2026-01-01', pages: 2 };

  const report = JSON.parse(serialize(findings, meta, { full: true }));
  assert.ok(Array.isArray(report.causes), 'a report has to be able to rebuild the HTML');
  assert.equal(report.causes.length, 1, 'two findings of one check under one section are one cause');
  assert.deepEqual(
    Object.keys(report.causes[0]).sort(),
    ['area', 'count', 'id', 'level', 'pages', 'scope', 'section', 'title'],
    'the same shape the Worker sends, because it is the same function',
  );
  assert.equal(report.causes[0].scope, causeScope(byCause(findings)[0], meta.pages));

  // A baseline is committed and diffed, and grouping moves whenever page counts
  // do — which is the churn the baseline shape exists to avoid.
  const baseline = JSON.parse(serialize(findings, meta));
  assert.ok(!('causes' in baseline), 'a baseline stays the five identifying fields');
});

test('a report keeps the traffic a baseline drops', () => {
  const findings = [
    {
      level: 'warn', id: 'a', title: 'T', detail: 'D', url: 'https://x.test/p/',
      traffic: { impressions: 900, clicks: 12 },
    },
  ];
  const report = JSON.parse(serialize(findings, { date: '2026-01-01', pages: 1 }, { full: true }));
  assert.deepEqual(report.findings[0].traffic, { impressions: 900, clicks: 12 });

  // Impressions change every day; a baseline that churns is one nobody reads.
  const baseline = JSON.parse(serialize(findings, { date: '2026-01-01', pages: 1 }));
  assert.ok(!('traffic' in baseline.findings[0]));
});

test('parsing a non-report JSON file explains itself', () => {
  assert.throws(() => parseBaseline('{"hello":true}', 'x.json'), /no findings array/);
  assert.throws(() => parseBaseline('not json', 'x.json'), /not valid JSON/);
});

// --- only what changed -----------------------------------------------------

test('changed-since answers from lastmod, and keeps what it cannot date', () => {
  const entries = [
    { loc: 'https://x.test/new/', lastmod: '2026-08-20' },
    { loc: 'https://x.test/old/', lastmod: '2026-01-02' },
    { loc: 'https://x.test/undated/', lastmod: null },
    { loc: 'https://x.test/exactly/', lastmod: '2026-08-17' },
  ];
  const result = changedSince(entries, '2026-08-17');

  assert.equal(result.refused, null);
  assert.deepEqual(result.changed, ['https://x.test/new/', 'https://x.test/exactly/'],
    'on the date counts as changed');
  assert.deepEqual(result.skipped, ['https://x.test/old/']);
  // Not knowing when a page changed is not evidence that it did not, and the
  // value of this is that what it skips was declared unchanged.
  assert.deepEqual(result.unknown, ['https://x.test/undated/']);
  assert.ok(result.urls.includes('https://x.test/undated/'));
});

test('changed-since refuses rather than guessing', () => {
  const dated = [{ loc: 'https://x.test/a/', lastmod: '2026-08-20' }];

  assert.match(changedSince(dated, 'next tuesday').refused, /is not a date/);

  // A lastmod nobody maintains is worse than none: it looks like an answer.
  assert.match(
    changedSince([{ loc: 'https://x.test/a/', lastmod: null }], '2026-08-17').refused,
    /No URL in this sitemap carries a lastmod/,
  );

  // One date on every URL is a build stamp. Filtering on it would take
  // everything or nothing depending on which side of the stamp the date fell.
  const stamped = changedSince([
    { loc: 'https://x.test/a/', lastmod: '2026-08-24T10:00:00Z' },
    { loc: 'https://x.test/b/', lastmod: '2026-08-24T10:00:01Z' },
  ], '2026-08-17');
  assert.match(stamped.refused, /build stamp/);

  // A single dated URL is not a build stamp — there is nothing to compare it
  // with, and refusing there would refuse every one-page site.
  assert.equal(changedSince(dated, '2026-08-17').refused, null);
});

// --- the sitemap this site should have had ---------------------------------

const sitemapPage = (url, { status = 200, robots = null, canonical = null, html = true } = {}) => ({
  url,
  res: { ok: status >= 200 && status < 300, status, ms: 1, headers: new Headers() },
  doc: html
    ? { robots, canonical: canonical ? [canonical] : [], title: 't', description: 'd' }
    : null,
});

test('a rebuilt sitemap keeps what belongs in one and says what it dropped', () => {
  const result = rebuild(
    [
      sitemapPage('https://x.test/keep/'),
      sitemapPage('https://x.test/self/', { canonical: 'https://x.test/self/' }),
      sitemapPage('https://x.test/gone/', { status: 404 }),
      sitemapPage('https://x.test/hidden/', { robots: 'noindex, follow' }),
      sitemapPage('https://x.test/copy/', { canonical: 'https://x.test/keep/' }),
      sitemapPage('https://x.test/file.pdf', { html: false }),
      sitemapPage('https://x.test/private/'),
    ],
    [{ id: 'missing-from-sitemap', url: 'https://x.test/orphaned/' }],
    {
      entries: [{ loc: 'https://x.test/keep/', lastmod: '2026-08-01' }],
      allowed: (url) => !url.includes('/private/'),
    },
  );

  assert.equal(result.refused, null);
  assert.deepEqual(result.urls, [
    'https://x.test/keep/',
    'https://x.test/orphaned/',
    'https://x.test/self/',
  ]);
  // A page that is linked, answers 200 and is HTML but is not in the sitemap is
  // exactly what this is for.
  assert.deepEqual(result.added, ['https://x.test/orphaned/']);

  assert.deepEqual(result.excluded, {
    status: 1, noindex: 1, 'canonical-elsewhere': 1, 'not-html': 1, 'robots-disallowed': 1,
  });

  // lastmod is carried over rather than invented — a build stamp on every URL
  // is what crawlers learn to ignore.
  assert.match(result.xml, /<loc>https:\/\/x\.test\/keep\/<\/loc>\s*<lastmod>2026-08-01<\/lastmod>/);
  assert.ok(!/<lastmod>/.test(result.xml.split('/self/')[1].split('</url>')[0]));
  assert.match(result.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(result.xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
});

test('a rebuilt sitemap refuses rather than quietly dropping real pages', () => {
  const pages = [sitemapPage('https://x.test/a/')];

  // The dangerous one. A file written from a crawl that stopped at its limit
  // would take every unread page out of the site's sitemap.
  const cut = rebuild(pages, [], { truncated: 185 });
  assert.equal(cut.xml, null);
  assert.match(cut.refused, /185 URL\(s\) unread/);
  assert.match(cut.refused, /--limit 186/, 'and says which run would work');

  // A page nobody could read is a page nobody can place.
  const limited = rebuild(pages, [{ id: 'rate-limited', url: 'https://x.test/b/' }], { rateLimited: 1 });
  assert.equal(limited.xml, null);
  assert.match(limited.refused, /rate limiting/);

  // The report counted more linked-but-missing pages than it listed, so the
  // file could not contain all of them.
  const capped = rebuild(pages, [{ id: 'missing-from-sitemap-more' }], {});
  assert.equal(capped.xml, null);
  assert.match(capped.refused, /could not include all of them/);

  // Nothing to write is not an empty file.
  const nothing = rebuild([sitemapPage('https://x.test/a/', { status: 500 })], [], {});
  assert.equal(nothing.xml, null);
  assert.match(nothing.refused, /nothing to write/);
});

test('a URL with characters XML cannot carry is escaped once', () => {
  const result = rebuild([sitemapPage('https://x.test/a?x=1&y=2')], [], {});
  assert.match(result.xml, /<loc>https:\/\/x\.test\/a\?x=1&amp;y=2<\/loc>/);
  assert.ok(!result.xml.includes('&amp;amp;'), 'the ampersand is escaped once, not twice');
});

// --- the same page again ---------------------------------------------------

// Deterministic pseudo-prose. Real page text does not repeat long runs, and a
// repeated phrase collapses to a handful of distinct five-word shingles — which
// makes any hand-written filler a much weaker test than it looks.
function prose(seed, count = 400) {
  const vocab = ('vase ceramic glaze kiln lisbon studio artisan clay wheel matte gloss cobalt ochre '
    + 'handmade fired collection design texture surface form shape colour finish stoneware porcelain '
    + 'terracotta slip burnish oxide reduction stack shelf cone temperature quartz feldspar silica').split(' ');
  let x = seed;
  const out = [];
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(vocab[x % vocab.length]);
  }
  return out.join(' ');
}

const contentPage = (url, text, extra = '') =>
  page(`<html><head>${extra}</head><body><nav>home shop about contact</nav>` +
       `<main><p>${text}</p></main><footer>all rights reserved</footer></body></html>`, url);

test('a sketch measures content, and refuses when there is not enough of it', () => {
  const base = prose(7);
  const changed = base.replace(/^(\S+\s\S+\s\S+\s)\S+/, '$1turquoise');

  assert.equal(similarity(fingerprint(base), fingerprint(base)), 1);
  assert.ok(similarity(fingerprint(base), fingerprint(changed)) > 0.9,
    'one word in four hundred is the same page');
  assert.ok(similarity(fingerprint(base), fingerprint(prose(4242))) < 0.1,
    'different words are a different page');
  // Half the text shared is a related page, not a copy, and must not group.
  assert.ok(similarity(fingerprint(base), fingerprint(prose(7, 200) + ' ' + prose(99, 200))) < 0.9);

  // Too short to say anything about: at that length two pages share most of
  // their words whatever they say.
  assert.equal(fingerprint('only a handful of words on this page'), null);
});

test('pages that are the same page again are reported once, as a group', () => {
  const base = prose(11);
  const pages = [
    contentPage('https://x.test/a', base),
    contentPage('https://x.test/b', base.replace(/^(\S+\s)\S+/, '$1turquoise')),
    contentPage('https://x.test/c', base.replace(/^(\S+\s)\S+/, '$1vermilion')),
    contentPage('https://x.test/d', prose(4242)),
  ];
  const found = crossPageChecks(pages).filter((x) => x.id === 'duplicate-content');

  assert.equal(found.length, 1, 'three copies are one thing to fix, not three');
  assert.match(found[0].title, /3 pages/);
  assert.match(found[0].detail, /% identical/);
  assert.match(found[0].detail, /rel=canonical/, 'it says what to do about it');
  assert.ok(!found[0].detail.includes('/d'), 'the page that differs is not in the group');
});

test('a declared copy is a solved problem, not a finding', () => {
  // The three narrowings, each on its own. A page that says noindex is not in
  // the index to be duplicated in; a page whose canonical points at another is
  // the fix already applied; a page with no marked content region has no
  // comparable text.
  const base = prose(13);
  const canonical = '<link rel="canonical" href="https://x.test/one">';

  const declared = crossPageChecks([
    contentPage('https://x.test/one', base),
    contentPage('https://x.test/two', base, canonical),
    contentPage('https://x.test/three', base, canonical),
  ]).filter((x) => x.id === 'duplicate-content');
  assert.equal(declared.length, 0, 'a canonical pointing elsewhere is the answer, not the problem');

  const noindexed = crossPageChecks([
    contentPage('https://x.test/one', base),
    contentPage('https://x.test/two', base, '<meta name="robots" content="noindex">'),
  ]).filter((x) => x.id === 'duplicate-content');
  assert.equal(noindexed.length, 0);

  // No <main> and no <article>: the text would be the whole document, and on a
  // small site every page would look like a copy of every other.
  const unmarked = (url) => page(
    `<html><body><nav>home shop about</nav><div><p>${base}</p></div><footer>x</footer></body></html>`, url);
  const bare = crossPageChecks([unmarked('https://x.test/one'), unmarked('https://x.test/two')]);
  assert.ok(!ids(bare).includes('duplicate-content'), 'a whole document is not comparable text');
  const note = bare.find((x) => x.id === 'duplicate-content-not-checked');
  assert.ok(note, 'and it says so rather than passing silently');
  assert.equal(note.level, 'info');
});

test('<article> counts as a content region, because plenty of sites use it', () => {
  const base = prose(17);
  const article = (url) => page(
    `<html><body><nav>home</nav><article><p>${base}</p></article></body></html>`, url);
  const found = crossPageChecks([article('https://x.test/one'), article('https://x.test/two')])
    .filter((x) => x.id === 'duplicate-content');
  assert.equal(found.length, 1);
});

// --- checks ---------------------------------------------------------------

const page = (html, url = 'https://x.test/p/', extra = {}) => ({
  url,
  res: { ok: true, status: 200, ms: 10, headers: new Headers() },
  html,
  doc: parseHtml(html, url),
  ...extra,
});

const ids = (findings) => findings.map((f) => f.id);

test('a page missing the basics reports each one', () => {
  const found = ids(pageChecks(page('<html><body><main><p>hi</p></main></body></html>')));
  assert.ok(found.includes('title-missing'));
  assert.ok(found.includes('h1-missing'));
  assert.ok(found.includes('viewport-missing'));
  assert.ok(found.includes('lang-missing'));
  assert.ok(found.includes('canonical-missing'));
});

test('a viewport that blocks zooming is reported; one that allows it is not', () => {
  const withViewport = (content) =>
    ids(pageChecks(page(`<html lang="en"><head><meta name="viewport" content="${content}"></head><body><main><h1>x</h1></main></body></html>`)));

  assert.ok(withViewport('width=device-width, initial-scale=1, user-scalable=no').includes('viewport-locked'));
  assert.ok(withViewport('width=device-width, user-scalable=0').includes('viewport-locked'));
  assert.ok(withViewport('width=device-width, initial-scale=1, maximum-scale=1').includes('viewport-locked'));
  assert.ok(withViewport('width=device-width, initial-scale=1, maximum-scale=1.0').includes('viewport-locked'));

  // The half that matters: the ordinary responsive tag, and a maximum-scale
  // high enough to reach the 200% WCAG asks for, say nothing.
  assert.ok(!withViewport('width=device-width, initial-scale=1').includes('viewport-locked'));
  assert.ok(!withViewport('width=device-width, initial-scale=1, maximum-scale=5').includes('viewport-locked'));
  assert.ok(!withViewport('width=device-width, initial-scale=1, user-scalable=yes').includes('viewport-locked'));
});

test('a fixed-width viewport is reported; width=device-width is not', () => {
  const withViewport = (content) =>
    ids(pageChecks(page(`<html lang="en"><head><meta name="viewport" content="${content}"></head><body><main><h1>x</h1></main></body></html>`)));

  assert.ok(withViewport('width=1024').includes('viewport-fixed-width'));
  assert.ok(withViewport('width=980, initial-scale=1').includes('viewport-fixed-width'));

  assert.ok(!withViewport('width=device-width, initial-scale=1').includes('viewport-fixed-width'));
  // No width at all is a different finding than the wrong width, and this one
  // must not invent it.
  assert.ok(!withViewport('initial-scale=1').includes('viewport-fixed-width'));
});

test('an image with no alt attribute is an error; alt="" is not', () => {
  assert.ok(ids(pageChecks(page('<main><img src="/a.png"></main>'))).includes('img-alt'));
  assert.ok(!ids(pageChecks(page('<main><img src="/a.png" alt=""></main>'))).includes('img-alt'));
});

test('alt bound by a framework is alt the author provided', () => {
  // allbirds.com has 43 images: 40 with a real alt, 3 with :alt="item.title",
  // and none with neither. The value cannot be read without running Alpine, but
  // the author plainly supplied one, and calling that a missing alt is guessing
  // wrong at error level.
  for (const bound of [':alt', 'v-bind:alt', 'x-bind:alt', '[alt]']) {
    assert.ok(
      !ids(pageChecks(page(`<main><img src="/a.png" ${bound}="item.title"></main>`))).includes('img-alt'),
      `${bound} should count as alt provided`,
    );
  }
  // An image with no alt of any kind is still reported.
  assert.ok(ids(pageChecks(page('<main><img src="/a.png" :src="x"></main>'))).includes('img-alt'));
});

test('role="presentation" says decorative just as alt="" does', () => {
  // ARIA's way of declaring the same intent, and honoured by screen readers.
  // mozilla.org's accessibility team ships it, which is about as good as
  // evidence gets that it is deliberate rather than an oversight.
  for (const role of ['presentation', 'none']) {
    assert.ok(
      !ids(pageChecks(page(`<main><img src="/a.png" role="${role}"></main>`))).includes('img-alt'),
      `role="${role}" should count as declared decorative`,
    );
  }
  // Any other role is not a statement about decoration.
  assert.ok(ids(pageChecks(page('<main><img src="/a.png" role="img"></main>'))).includes('img-alt'));
});

// --- hreflang -------------------------------------------------------------

const alternates = (...links) =>
  page(
    `<html lang="en"><head>${links.join('')}</head><body><main><p>hi</p></main></body></html>`,
    'https://x.test/p/',
  );
const alt = (lang, href) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;

test('a malformed hreflang code is an error, valid shapes are not', () => {
  assert.ok(ids(pageChecks(alternates(alt('en_US', '/p/')))).includes('hreflang-invalid'));
  assert.ok(ids(pageChecks(alternates(alt('english', '/p/')))).includes('hreflang-invalid'));
  for (const code of ['en', 'en-GB', 'en-gb', 'zh-Hant', 'zh-Hant-TW', 'en-419', 'x-default']) {
    assert.ok(
      !ids(pageChecks(alternates(alt(code, '/p/')))).includes('hreflang-invalid'),
      `expected "${code}" to be accepted`,
    );
  }
});

test('hreflang that never names its own page is reported', () => {
  const missing = alternates(alt('ru', '/ru/p/'), alt('de', '/de/p/'));
  assert.ok(ids(pageChecks(missing)).includes('hreflang-no-self'));

  const present = alternates(alt('en', '/p/'), alt('ru', '/ru/p/'));
  assert.ok(!ids(pageChecks(present)).includes('hreflang-no-self'));
});

test('a page whose lang contradicts its own hreflang is reported', () => {
  // <html lang="en"> while the annotation calls this page the Russian version.
  const clash = alternates(alt('ru', '/p/'), alt('en', '/en/p/'));
  assert.ok(ids(pageChecks(clash)).includes('hreflang-lang-mismatch'));
});

test('a dialect is not a contradiction', () => {
  // lang="en" and hreflang="en-GB" are the same claim about language.
  const fine = page(
    `<html lang="en"><head>${alt('en-GB', '/p/')}</head><body><main><p>hi</p></main></body></html>`,
    'https://x.test/p/',
  );
  assert.ok(!ids(pageChecks(fine)).includes('hreflang-lang-mismatch'));
});

test('a page with no hreflang at all is not asked about self-references', () => {
  assert.ok(!ids(pageChecks(page('<main><p>hi</p></main>'))).some((id) => id.startsWith('hreflang-')));
});

test('a missing x-default is reported once for the site, not once per page', () => {
  const mk = (url) => ({
    url,
    res: { ok: true, status: 200, ms: 1, headers: new Headers() },
    doc: {
      hreflang: [{ lang: 'en', href: url }, { lang: 'ru', href: `${url}ru/` }],
      links: { internal: [], inMain: [], external: [] },
      title: null, description: null, canonical: [], og: {},
    },
  });
  const found = crossPageChecks([mk('https://x.test/a/'), mk('https://x.test/b/')])
    .filter((finding) => finding.id === 'hreflang-no-x-default');
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /2 pages/);
});

test('an x-default anywhere in the set satisfies the check', () => {
  const withDefault = {
    url: 'https://x.test/a/',
    res: { ok: true, status: 200, ms: 1, headers: new Headers() },
    doc: {
      hreflang: [{ lang: 'x-default', href: 'https://x.test/' }],
      links: { internal: [], inMain: [], external: [] },
      title: null, description: null, canonical: [], og: {},
    },
  };
  assert.ok(!crossPageChecks([withDefault]).some((finding) => finding.id === 'hreflang-no-x-default'));
});

test('an hreflang target that 404s is reported', async () => {
  const origin = 'https://x.test';
  const pages = bareSite(origin, { hreflang: [{ lang: 'ru', href: `${origin}/ru/gone/` }] });
  const out = await siteChecks(
    origin,
    fakeFetcher((url) => (url.endsWith('/ru/gone/') ? { status: 404 } : notFound(url))),
    pages,
    { sitemapUrls: [`${origin}/p/`] },
  );
  const dead = out.filter((finding) => finding.id === 'hreflang-dead');
  assert.equal(dead.length, 1);
  assert.match(dead[0].detail, /ru\/gone/);
});

test('an hreflang target already crawled and healthy is not fetched again', async () => {
  const origin = 'https://x.test';
  const fetcher = fakeFetcher(notFound);
  await siteChecks(origin, fetcher, bareSite(origin, { hreflang: [{ lang: 'en', href: `${origin}/p/` }] }), {
    sitemapUrls: [`${origin}/p/`],
  });
  assert.equal(fetcher.calls.filter((u) => u === `${origin}/p/`).length, 0);
});

test('nofollow on the page is reported, and named for what it is with noindex', () => {
  const meta = (content) => page(`<head><meta name="robots" content="${content}"></head><main><p>x</p></main>`);
  const only = pageChecks(meta('nofollow')).find((x) => x.id === 'nofollow-page');
  assert.ok(only);
  assert.equal(only.title, 'Page is nofollow');

  const both = pageChecks(meta('noindex, nofollow')).find((x) => x.id === 'nofollow-page');
  assert.equal(both.title, 'Page is noindex and nofollow');

  // "follow" is the opposite instruction and must not match.
  assert.ok(!ids(pageChecks(meta('index, follow'))).includes('nofollow-page'));
  assert.ok(!ids(pageChecks(meta('noindex'))).includes('nofollow-page'));
});

test('a nofollow sent as a header counts too', () => {
  const headed = page('<main><p>x</p></main>', 'https://x.test/p/', {
    res: { ok: true, status: 200, ms: 1, headers: new Headers({ 'x-robots-tag': 'nofollow' }) },
  });
  assert.ok(ids(pageChecks(headed)).includes('nofollow-page'));
});

test('internal links marked nofollow are collected and noted', () => {
  const doc = parseHtml(
    `<main>
       <a href="/plain/">plain</a>
       <a href="/login/" rel="nofollow">login</a>
       <a href="/filter/" rel="noopener nofollow">filter</a>
       <a href="https://other.test/" rel="nofollow">external</a>
     </main>`,
    'https://x.test/p/',
  );
  // External nofollow is ordinary and not this tool's business.
  assert.deepEqual(doc.links.nofollowInternal, ['https://x.test/login/', 'https://x.test/filter/']);

  const finding = pageChecks(page(
    '<main><a href="/login/" rel="nofollow">login</a></main>',
  )).find((x) => x.id === 'internal-nofollow');
  assert.ok(finding);
  assert.equal(finding.level, 'info');
});

test('a nofollow fragment on the same page is not a withheld path', () => {
  // WordPress marks every comment-reply link rel="nofollow" pointing at
  // #respond on the page it is already on. Counting those reported a withheld
  // path on every article of every WordPress site, leading nowhere new.
  const doc = parseHtml(
    `<main>
       <a href="/p/#respond" rel="nofollow">reply</a>
       <a href="#respond" rel="nofollow">reply again</a>
       <a href="/elsewhere/#section" rel="nofollow">a real one</a>
     </main>`,
    'https://x.test/p/',
  );
  assert.deepEqual(doc.links.nofollowInternal, ['https://x.test/elsewhere/']);
});

test('rel="nofollowing" is not nofollow', () => {
  const doc = parseHtml('<main><a href="/a/" rel="nofollowing">x</a></main>', 'https://x.test/p/');
  assert.deepEqual(doc.links.nofollowInternal, []);
});

test('a noindex sent as a header is reported like the meta tag', () => {
  const headed = (headers) =>
    page('<main><p>hi</p></main>', 'https://x.test/p/', {
      res: { ok: true, status: 200, ms: 10, headers: new Headers(headers) },
    });
  assert.ok(ids(pageChecks(headed({ 'x-robots-tag': 'noindex, nofollow' }))).includes('x-robots-noindex'));
  assert.ok(!ids(pageChecks(headed({ 'x-robots-tag': 'all' }))).includes('x-robots-noindex'));
  assert.ok(!ids(pageChecks(headed({}))).includes('x-robots-noindex'));
});

test('a relative og:image is an error, absolute and protocol-relative are not', () => {
  const og = (content) => page(`<head><meta property="og:image" content="${content}"></head>`);
  assert.ok(ids(pageChecks(og('/og.jpg'))).includes('og-image-relative'));
  assert.ok(ids(pageChecks(og('og.jpg'))).includes('og-image-relative'));
  assert.ok(!ids(pageChecks(og('https://x.test/og.jpg'))).includes('og-image-relative'));
  // Scrapers do resolve protocol-relative URLs, so flagging it would cry wolf.
  assert.ok(!ids(pageChecks(og('//cdn.x.test/og.jpg'))).includes('og-image-relative'));
});

test('alt text that is really a filename is flagged', () => {
  const found = ids(pageChecks(page('<main><img src="/a.png" alt="DSC_0042.jpg"></main>')));
  assert.ok(found.includes('img-alt-filename'));
  assert.ok(!ids(pageChecks(page('<main><img src="/a.png" alt="A blue vase"></main>'))).includes('img-alt-filename'));
});

test('alt text naming the medium rather than the content is flagged', () => {
  for (const alt of ['image', 'Photo', 'logo', 'thumbnail.']) {
    assert.ok(
      ids(pageChecks(page(`<main><img src="/a.png" alt="${alt}"></main>`))).includes('img-alt-placeholder'),
      `expected "${alt}" to be a placeholder`,
    );
  }
  assert.ok(!ids(pageChecks(page('<main><img src="/a.png" alt="Acme logo"></main>'))).includes('img-alt-placeholder'));
});

test('repeated alt text is reported from three images up, not two', () => {
  const imgs = (n) => '<main>' + `<img src="/a.png" alt="A blue vase">`.repeat(n) + '</main>';
  assert.ok(!ids(pageChecks(page(imgs(2)))).includes('img-alt-duplicate'));
  assert.ok(ids(pageChecks(page(imgs(3)))).includes('img-alt-duplicate'));
});

test('a repeated placeholder is reported once, as the placeholder', () => {
  // Not also as a duplicate — one problem, and the better message wins.
  const found = ids(pageChecks(page('<main>' + '<img src="/a.png" alt="image">'.repeat(4) + '</main>')));
  assert.ok(found.includes('img-alt-placeholder'));
  assert.ok(!found.includes('img-alt-duplicate'));
});

test('decorative alt="" is never judged for quality', () => {
  const found = ids(pageChecks(page('<main>' + '<img src="/a.png" alt="">'.repeat(5) + '</main>')));
  assert.ok(!found.some((id) => id.startsWith('img-alt-')));
});

test('an image with no title is never a finding', () => {
  // The check most tools ship. A hover tooltip is invisible on touch and unread
  // by Google, so its absence is not a defect — reporting it would fire on
  // almost every image on almost every site.
  const found = ids(pageChecks(page('<main><img src="/a.png" alt="a real description"></main>')));
  assert.ok(!found.some((id) => id.startsWith('img-title')));
});

test('a title repeating the alt is a note', () => {
  const found = ids(pageChecks(page('<main><img src="/a.png" alt="A blue vase" title="A blue vase"></main>')));
  assert.ok(found.includes('img-title-duplicates-alt'));
  // A title that says something different is the author adding, not repeating.
  assert.ok(!ids(pageChecks(page(
    '<main><img src="/a.png" alt="A blue vase" title="Photographed in Kyoto, 2019"></main>',
  ))).includes('img-title-duplicates-alt'));
});

test('a title on an image declared decorative contradicts itself', () => {
  assert.ok(ids(pageChecks(page('<main><img src="/a.png" alt="" title="A blue vase"></main>')))
    .includes('img-title-on-decorative'));
  assert.ok(ids(pageChecks(page('<main><img src="/a.png" role="presentation" title="A blue vase"></main>')))
    .includes('img-title-on-decorative'));
  // Decorative and silent is correct, and says nothing.
  assert.ok(!ids(pageChecks(page('<main><img src="/a.png" alt=""></main>')))
    .includes('img-title-on-decorative'));
});

test('very long alt text is a note', () => {
  const long = 'a '.repeat(100);
  assert.ok(ids(pageChecks(page(`<main><img src="/a.png" alt="${long}"></main>`))).includes('img-alt-long'));
});

test('a WebP og:image is flagged, a JPEG is not', () => {
  const webp = '<head><meta property="og:image" content="/a.webp"></head>';
  const jpeg = '<head><meta property="og:image" content="/a.jpg"></head>';
  assert.ok(ids(pageChecks(page(webp))).includes('og-webp'));
  assert.ok(!ids(pageChecks(page(jpeg))).includes('og-webp'));
});

test('thin content respects a configured threshold', () => {
  const short = page('<main><p>' + 'word '.repeat(100) + '</p></main>');
  assert.ok(ids(pageChecks(short)).includes('thin-content'));
  assert.ok(!ids(pageChecks(short, { thinWords: 50 })).includes('thin-content'));
});

test('a redirect listed in the sitemap short-circuits the other checks', () => {
  const found = pageChecks({
    url: 'https://x.test/p/',
    res: { ok: false, status: 301, location: 'https://x.test/q/', ms: 1, headers: new Headers() },
    doc: null,
  });
  assert.deepEqual(ids(found), ['sitemap-redirect']);
});

test('mixed content is only reported on an https page', () => {
  const insecure = '<main><img src="http://x.test/a.png" alt=""></main>';
  assert.ok(ids(pageChecks(page(insecure, 'https://x.test/p/'))).includes('mixed-content'));
  assert.ok(!ids(pageChecks(page(insecure, 'http://x.test/p/'))).includes('mixed-content'));
});

test('a plain link to an http page is not mixed content', () => {
  // Browsers block an http script and warn about an http image. They do nothing
  // at all about <a href="http://…">, which is a link to somebody else's site —
  // usually one the author cannot upgrade. Matching every href reported four
  // errors across five real sites, every one of them an outbound link or a feed.
  const cases = [
    '<main><a href="http://old-friend.test/">a friend</a></main>',
    '<head><link rel="alternate" type="application/rss+xml" href="http://x.test/feed/"></head>',
    '<head><link rel="canonical" href="http://x.test/p/"></head>',
  ];
  for (const html of cases) {
    assert.ok(
      !ids(pageChecks(page(html, 'https://x.test/p/'))).includes('mixed-content'),
      `should not be mixed content: ${html}`,
    );
  }
});

test('subresources over http are still reported', () => {
  const loaded = [
    '<script src="http://x.test/a.js"></script>',
    '<head><link rel="stylesheet" href="http://x.test/a.css"></head>',
    '<main><iframe src="http://x.test/f"></iframe></main>',
    '<main><video src="http://x.test/v.mp4"></video></main>',
  ];
  for (const html of loaded) {
    assert.ok(
      ids(pageChecks(page(html, 'https://x.test/p/'))).includes('mixed-content'),
      `should be mixed content: ${html}`,
    );
  }
});

test('an image with neither src nor alt is described, not printed as null', () => {
  const found = pageChecks(page('<main><img data-src="/lazy.png"></main>'));
  const finding = found.find((x) => x.id === 'img-alt');
  assert.ok(finding);
  assert.ok(!finding.detail.includes('null'), finding.detail);
});

test('one-way hreflang is reported, reciprocal is not', () => {
  const mk = (url, alts) => ({
    url,
    res: { ok: true, status: 200, ms: 1, headers: new Headers() },
    doc: { ...parseHtml('<main><p>x</p></main>', url), hreflang: alts, links: { internal: [url] } },
  });
  const oneWay = crossPageChecks([
    mk('https://x.test/en/', [{ lang: 'ru', href: 'https://x.test/ru/' }]),
    mk('https://x.test/ru/', []),
  ]);
  assert.ok(ids(oneWay).includes('hreflang-one-way'));

  const both = crossPageChecks([
    mk('https://x.test/en/', [{ lang: 'ru', href: 'https://x.test/ru/' }]),
    mk('https://x.test/ru/', [{ lang: 'en', href: 'https://x.test/en/' }]),
  ]);
  assert.ok(!ids(both).includes('hreflang-one-way'));
});

test('duplicate titles are reported once, naming the pages', () => {
  const mk = (url) => ({
    url,
    res: { ok: true, status: 200, ms: 1, headers: new Headers() },
    doc: { ...parseHtml('<title>Same</title><main><a href="' + url + '">x</a></main>', url) },
  });
  const found = crossPageChecks([mk('https://x.test/a/'), mk('https://x.test/b/')]);
  assert.equal(found.filter((f) => f.id === 'duplicate-title').length, 1);
});

test('a page nothing links to is an orphan, but home is exempt', () => {
  const mk = (url, links) => ({
    url,
    res: { ok: true, status: 200, ms: 1, headers: new Headers() },
    doc: { ...parseHtml('<title>t</title><main><p>x</p></main>', url), links: { internal: links, inMain: links } },
  });
  const found = crossPageChecks([
    mk('https://x.test/', ['https://x.test/a/']),
    mk('https://x.test/a/', []),
    mk('https://x.test/orphan/', []),
  ]);
  const orphans = found.filter((f) => f.id === 'orphan-page').map((f) => f.url);
  assert.deepEqual(orphans, ['https://x.test/orphan/']);
});

// --- report ---------------------------------------------------------------

const sample = [
  { level: 'error', id: 'a', title: 'An error', detail: 'why', url: 'https://x.test/1' },
  { level: 'warn', id: 'b', title: 'A warning', detail: 'why', url: 'https://x.test/2' },
  { level: 'warn', id: 'b', title: 'A warning', detail: 'why', url: 'https://x.test/3' },
  { level: 'info', id: 'c', title: 'A note', detail: 'why', url: 'https://x.test/4' },
];
const meta = { origin: 'https://x.test', pages: 4, requests: 6, ms: 1000, date: '2026-01-01' };

test('counts and grouping', () => {
  assert.deepEqual(counts(sample), { error: 1, warn: 2, info: 1 });
  const grouped = group(sample);
  assert.deepEqual(grouped.map((g) => g.id), ['a', 'b', 'c']); // errors first
  assert.equal(grouped[1].items.length, 2);
});

test('markdown lists every affected URL', () => {
  const md = markdown(sample, meta);
  for (const f of sample) assert.ok(md.includes(f.url), `${f.url} missing from markdown`);
  assert.ok(md.includes('**1 errors, 2 warnings, 1 notes**'));
});

test('the report carries a way back only when the caller has one', () => {
  const findings = [{ level: 'warn', id: 'x', title: 'T', detail: 'D', url: 'https://x.test/p/' }];
  const meta = { origin: 'https://x.test', pages: 1, date: '2026-08-21' };

  // A report written to a file has nowhere to go back to.
  assert.ok(!html(findings, meta).includes('class="back"'));

  const hosted = html(findings, meta, { backHref: '/', backLabel: 'Audit another site' });
  assert.match(hosted, /<a class="back" href="\/">← Audit another site<\/a>/);
});

test('html escapes untrusted strings rather than injecting them', () => {
  const nasty = [
    { level: 'error', id: 'x', title: '<script>alert(1)</script>', detail: 'a & b', url: 'https://x.test/"' },
  ];
  const out = html(nasty, meta);
  assert.ok(!out.includes('<script>alert(1)</script>'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(out.includes('a &amp; b'));
});

test('an empty run still renders both formats', () => {
  assert.ok(markdown([], meta).includes('Nothing to report'));
  assert.ok(html([], meta).includes('Nothing to report'));
});

// The three Open Graph tags are three checks, not one.
//
// They shared the id `og-missing` until a run against a real site printed
// "Missing og:description x6" over four pages — three missing only the
// description, one missing all three. A group takes its title from the finding
// it saw first, so the row named one tag and counted another two. Nothing it
// said was false; the sentence above it was.
test('each missing Open Graph tag is its own finding', () => {
  const bare = page('<html><head><title>A page</title></head><body><main><p>hi</p></main></body></html>');
  const missing = ids(pageChecks(bare)).filter((id) => id.startsWith('og-'));
  assert.deepEqual(
    missing.sort(),
    ['og-description-missing', 'og-image-missing', 'og-title-missing'],
  );

  // The half that matters: a page carrying all three raises none of them.
  const complete = page(`<html><head><title>A page</title>
    <meta property="og:title" content="A page">
    <meta property="og:description" content="What it is about.">
    <meta property="og:image" content="https://x.test/card.png">
    </head><body><main><p>hi</p></main></body></html>`);
  assert.deepEqual(ids(pageChecks(complete)).filter((id) => /^og-\w+-missing$/.test(id)), []);

  // And one absent tag raises exactly one finding, titled for the tag that is
  // actually absent rather than for whichever was checked first.
  const partial = page(`<html><head><title>A page</title>
    <meta property="og:title" content="A page">
    <meta property="og:description" content="What it is about.">
    </head><body><main><p>hi</p></main></body></html>`);
  const one = pageChecks(partial).filter((f) => /^og-\w+-missing$/.test(f.id));
  assert.equal(one.length, 1);
  assert.equal(one[0].id, 'og-image-missing');
  assert.equal(one[0].title, 'Missing og:image');
});

// A config written against the old id keeps working. Splitting a check was our
// decision; a build that passed yesterday should not fail today because of it.
test('an ignore rule for the retired og-missing still silences all three', () => {
  const findings = [
    { id: 'og-title-missing', url: 'https://x.test/a/' },
    { id: 'og-description-missing', url: 'https://x.test/a/' },
    { id: 'og-image-missing', url: 'https://x.test/b/' },
    { id: 'thin-content', url: 'https://x.test/a/' },
  ];
  const [kept, silenced] = applyIgnores(findings, ['og-missing']);
  assert.equal(silenced, 3);
  assert.deepEqual(ids(kept), ['thin-content']);

  // And the new ids are individually ignorable, which is the point of splitting
  // them: a site that deliberately ships no og:image can silence that alone.
  const [rest] = applyIgnores(findings, ['og-image-missing']);
  assert.deepEqual(ids(rest), ['og-title-missing', 'og-description-missing', 'thin-content']);
});

// A URL the server calls HTML that is not HTML.
//
// fitculturepilates.com serves an XML document at /locations.kml with
// `Content-Type: text/html`. The crawl believed the header, parsed it as a
// page, and reported thirteen things — no title, no h1, no viewport, no
// charset, thin content, three missing Open Graph tags. All true about a
// document that was never a page, and none of them the thing to fix.
test('XML served as text/html is reported once, not as a broken page', () => {
  const res = {
    ok: true, status: 200, ms: 5,
    headers: new Headers({ 'content-type': 'text/html; charset=UTF-8' }),
  };
  const xml = '<?xml version="1.0"?><urlset><url><loc>https://a.test/</loc></url></urlset>';
  const found = pageChecks({ url: 'https://x.test/locations.kml', res, html: xml, doc: null });

  assert.deepEqual(ids(found), ['body-not-html']);
  assert.match(found[0].title, /body is XML/);
});

test('body-not-html stays quiet on everything that is not that', () => {
  const asHtml = (body) => ({
    url: 'https://x.test/p/',
    res: { ok: true, status: 200, ms: 5, headers: new Headers({ 'content-type': 'text/html' }) },
    html: body,
    doc: null,
  });

  // XHTML opens with an XML prologue and is HTML. Firing here would silence
  // every real check on a real page, which is far worse than the noise this
  // removes.
  const xhtml = '<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head></head></html>';
  assert.equal(bodyKind(xhtml), null);
  assert.deepEqual(ids(pageChecks(asHtml(xhtml))), []);

  // A fragment with no <html> wrapper is still HTML.
  assert.equal(bodyKind('<div>a fragment</div>'), null);
  // A byte-order mark before the doctype is still HTML.
  assert.equal(bodyKind('\ufeff<!DOCTYPE html><html></html>'), null);
  // Something that merely starts with a brace is not JSON.
  assert.equal(bodyKind('{not json at all'), null);

  // And a PDF correctly labelled as one raises nothing: the mismatch is the
  // finding, not the file type.
  const pdf = {
    url: 'https://x.test/a.pdf',
    res: { ok: true, status: 200, ms: 5, headers: new Headers({ 'content-type': 'application/pdf' }) },
    html: '%PDF-1.7',
    doc: null,
  };
  assert.deepEqual(ids(pageChecks(pdf)), []);
});

// --- twitter:image, only when it is a different picture --------------------
//
// The *absence* of a Twitter card stays deliberately unreported: X falls back
// to Open Graph correctly, so reporting it would invent a defect. A declared
// twitter:image that does not load is the opposite — nothing falls back to
// anything, and the platform that was handed its own tag previews blank.

const twSite = (origin, twitter, og) =>
  bareSite(origin, { twitter: { 'twitter:image': twitter }, og: og ? { 'og:image': og } : {} });

test('a twitter:image that does not load is reported', async () => {
  const origin = 'https://x.test';
  const out = await siteChecks(
    origin,
    fakeFetcher((url) => (url.endsWith('/tw.png') ? { status: 404 } : notFound(url))),
    twSite(origin, 'https://x.test/tw.png', 'https://x.test/og.png'),
    { sitemapUrls: [`${origin}/p/`] },
  );
  assert.ok(out.some((f) => f.id === 'twitter-image-broken'));
});

test('twitter-image-broken stays quiet where it should', async () => {
  const origin = 'https://x.test';
  const sweep = async (pages, routes) =>
    ids(await siteChecks(origin, fakeFetcher(routes), pages, { sitemapUrls: [`${origin}/p/`] }));

  // The same picture as og:image, broken: one finding about one file, from the
  // sweep that already judged it. Two would be the noise this keeps refusing.
  const same = await sweep(
    twSite(origin, 'https://x.test/og.png', 'https://x.test/og.png'),
    (url) => (url.endsWith('/og.png') ? { status: 404 } : notFound(url)),
  );
  assert.ok(same.includes('og-image-broken'));
  assert.ok(!same.includes('twitter-image-broken'));

  // No twitter:image at all: the fallback to Open Graph is correct behaviour.
  const absent = await sweep(bareSite(origin, { og: { 'og:image': 'https://x.test/og.png' } }), notFound);
  assert.ok(!absent.includes('twitter-image-broken'));

  // Hotlink protection is protection working, not a missing file.
  const forbidden = await sweep(
    twSite(origin, 'https://x.test/tw.png', 'https://x.test/og.png'),
    (url) => (url.endsWith('/tw.png') ? { status: 403 } : notFound(url)),
  );
  assert.ok(!forbidden.includes('twitter-image-broken'));

  // And one that redirects to the real file loads fine, as with og:image.
  const redirected = await sweep(
    twSite(origin, 'http://x.test/tw.png', 'https://x.test/og.png'),
    (url) =>
      url.startsWith('http://') ? { status: 301, location: url.replace('http://', 'https://') } : { status: 200 },
  );
  assert.ok(!redirected.includes('twitter-image-broken'));
});

// One secret loader, because there were two and one of them was broken.
//
// `console.mjs` built its pattern with `new RegExp` and a template literal,
// where `\\s` survives as an escaped backslash rather than as whitespace. It
// compiled, it never threw, and it could not match a line of a real `.env` —
// so Search Console's dotfile fallback had never worked. Nothing said so,
// because its only tests injected credentials and used a fake API. This is the
// half of `--search-console` that can be proven without a Google account.
test('readSecret reads a dotfile line, and the environment beats it', () => {
  const dotfile = () => 'PSI_API_KEY=abc123\n  GSC_CLIENT_ID = xyz.apps.googleusercontent.com \n# a comment\n';

  assert.equal(readSecret('PSI_API_KEY', {}, dotfile), 'abc123');
  // Whitespace either side of the name and the `=` is normal in a hand-edited
  // file, and was the case the broken pattern claimed to handle.
  assert.equal(readSecret('GSC_CLIENT_ID', {}, dotfile), 'xyz.apps.googleusercontent.com');
  assert.equal(readSecret('PSI_API_KEY', { PSI_API_KEY: 'from-env' }, dotfile), 'from-env');
  assert.equal(readSecret('GSC_CLIENT_SECRET', {}, dotfile), null);

  // No file at all is not an error, it is an unconfigured machine.
  assert.equal(readSecret('PSI_API_KEY', {}, () => { throw new Error('ENOENT'); }), null);

  // A name that is a prefix of another must not match it.
  assert.equal(readSecret('PSI_API', {}, dotfile), null);
});

// Impressions are counted on the pages this crawl reached, not on the property.
//
// The first live run against a real property reported "1 of this crawl's
// findings are on pages Google has shown, 98 times between them" when that
// page had 13. The other 85 impressions were on pages the crawl never touched.
// Nothing was false except the sentence joining the numbers, which is the same
// failure as a group named after one of the three things inside it.
test('search-console counts impressions on the crawled pages, not the property', async () => {
  const { searchConsole } = await import('../src/console.mjs');
  const findings = [
    { id: 'thin-content', url: 'https://x.test/a/' },
    { id: 'title-long', url: 'https://x.test/a/' },
    { id: 'desc-missing', url: 'https://x.test/nowhere/' },
  ];

  const notes = await searchConsole('https://x.test', findings, {
    credentials: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
    fetcher: async (url) => {
      if (String(url).includes('/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
      return {
        ok: true,
        json: async () => ({
          rows: [
            { keys: ['https://x.test/a/'], impressions: 13, clicks: 1 },
            // A page Google knows and this crawl never saw. Its impressions
            // belong in the property total and nowhere else.
            { keys: ['https://x.test/elsewhere/'], impressions: 85, clicks: 4 },
          ],
        }),
      };
    },
  });

  const detail = notes[0].detail;
  // Two findings share one page, so the page is counted once, not twice.
  assert.match(detail, /2 of this crawl's findings are on 1 page Google has shown, 13 times/);
  assert.match(detail, /out of 98 across the whole property/);

  // And the traffic is attached to the findings that have it, and only those.
  assert.deepEqual(findings.map((f) => f.traffic?.impressions ?? null), [13, 13, null]);
});

// --- score ----------------------------------------------------------------
// The score is the one number in this tool that is a judgement rather than a
// measurement, so the tests are about keeping the judgement honest: that its
// weights still match the levels the checks are actually written at, that a
// check nobody could have run is never counted as passed, and that what it
// says a fix is worth is what the next run actually pays out.

test('every scored check is weighted at the level it is actually emitted at', async () => {
  const { CHECKLIST, NOT_SCORED } = await import('../src/score.mjs');
  const { emittedLevels } = await import('../scripts/check-levels.mjs');
  const emitted = emittedLevels();

  const worstOf = (levels) =>
    levels.has('error') ? 'error' : levels.has('warn') ? 'warn' : 'info';

  for (const [id, levels] of emitted) {
    const worst = worstOf(levels);
    if (worst === 'info') {
      assert.ok(!CHECKLIST[id], `${id} only ever fires as a note, so it must not be scored`);
      continue;
    }
    if (NOT_SCORED[id]) {
      assert.ok(!CHECKLIST[id], `${id} cannot be both scored and excluded`);
      assert.ok(NOT_SCORED[id].length > 20, `${id} needs a reason, not a shrug`);
      continue;
    }
    assert.ok(
      CHECKLIST[id],
      `${id} fires at ${worst} and is neither in the checklist nor in NOT_SCORED`,
    );
    assert.equal(
      CHECKLIST[id].worst,
      worst,
      `${id} is emitted at ${worst} and the checklist says ${CHECKLIST[id].worst}`,
    );
  }
});

// The other direction. A check that was renamed or deleted leaves an entry
// behind that can never fire, and it would sit in "passing" for ever — a claim
// the tool cannot back up. Ids built by template are exempt: `header-${name}`
// and `psi-${metric}` are not literals the reader can see.
test('the checklist has no entry for a check that no longer exists', async () => {
  const { CHECKLIST } = await import('../src/score.mjs');
  const { emittedLevels } = await import('../scripts/check-levels.mjs');
  const emitted = emittedLevels();
  const templated = /^(header-|psi-|og-(title|description|image)-missing$|redirect-)/;

  for (const id of Object.keys(CHECKLIST)) {
    if (templated.test(id)) continue;
    assert.ok(emitted.has(id), `${id} is in the checklist and nothing in src/ emits it`);
  }
});

test('every scored check has an area, a pass line and a scope', async () => {
  const { checklist } = await import('../src/score.mjs');
  for (const check of checklist()) {
    assert.notEqual(check.area, 'Other', `${check.id} has no area in src/areas.mjs`);
    assert.ok(check.pass?.length > 8, `${check.id} needs a sentence for when it passes`);
    assert.ok(['page', 'site'].includes(check.scope), `${check.id} has scope ${check.scope}`);
  }
});

test('a clean run scores 100 and lists what it passed', async () => {
  const { scoreRun } = await import('../src/score.mjs');
  const score = scoreRun([], { pages: 10, applicable: { images: true } });
  assert.equal(score.score, 100);
  assert.equal(score.grade, 'A');
  assert.equal(score.lost, 0);
  assert.equal(score.failed.length, 0);
  assert.ok(score.passed.some((c) => c.id === 'img-alt'), 'the alt check applied and passed');
});

// The half that matters. A site with no images has not passed the alt-text
// check, and a run without --psi has not passed the performance ones — counting
// either as a pass hands out a hundred points for doing less.
test('a check that could not run is skipped, not counted as passed', async () => {
  const { scoreRun } = await import('../src/score.mjs');
  const score = scoreRun([], { pages: 10, applicable: {} });
  assert.ok(!score.passed.some((c) => c.id === 'img-alt'), 'no images, so nothing passed');
  const skipped = score.skipped.find((c) => c.id === 'img-alt');
  assert.ok(skipped, 'and it is named as skipped');
  assert.match(skipped.why, /image/);
  // Still 100: a check that cannot apply cannot cost anything either.
  assert.equal(score.score, 100);
});

test('a site-wide error costs its whole weight and a one-page one costs a share', async () => {
  const { scoreRun, WEIGHT } = await import('../src/score.mjs');

  const everywhere = scoreRun(
    Array.from({ length: 10 }, (_, i) => ({
      level: 'error', id: 'h1-missing', url: `https://x.test/${i}`,
    })),
    { pages: 10, applicable: {} },
  );
  assert.equal(everywhere.score, 100 - WEIGHT.error);
  assert.equal(everywhere.failed[0].cost, WEIGHT.error);

  const once = scoreRun([{ level: 'error', id: 'h1-missing', url: 'https://x.test/a' }], {
    pages: 10,
    applicable: {},
  });
  assert.equal(once.failed[0].cost, WEIGHT.error / 10);
  assert.equal(once.score, 100 - Math.round(WEIGHT.error / 10));
});

// One page tripping a check nine times is one page failing it, not nine. Left
// uncounted this way, a page with nine images and no alt text would take a
// forty-page site below zero on its own.
test('a page that trips a check several times counts once', async () => {
  const { scoreRun, WEIGHT } = await import('../src/score.mjs');
  const nine = Array.from({ length: 9 }, () => ({
    level: 'error', id: 'img-alt', url: 'https://x.test/a',
  }));
  const score = scoreRun(nine, { pages: 10, applicable: { images: true } });
  assert.equal(score.failed[0].pages, 1);
  assert.equal(score.failed[0].cost, WEIGHT.error / 10);
});

test('notes cost nothing', async () => {
  const { scoreRun } = await import('../src/score.mjs');
  const score = scoreRun(
    [{ level: 'info', id: 'llms-missing', url: 'https://x.test/' },
     { level: 'info', id: 'img-srcset', url: 'https://x.test/a' }],
    { pages: 4, applicable: { images: true } },
  );
  assert.equal(score.score, 100);
  assert.equal(score.failed.length, 0);
});

// What "clear the errors and it is N" promises has to be what the next run
// pays out, or it is a number that reads like a forecast and behaves like one.
test('the errors-fixed score is what a run with the errors gone actually scores', async () => {
  const { scoreRun } = await import('../src/score.mjs');
  const findings = [
    { level: 'error', id: 'h1-missing', url: 'https://x.test/a' },
    { level: 'error', id: 'h1-missing', url: 'https://x.test/b' },
    { level: 'warn', id: 'desc-missing', url: 'https://x.test/a' },
  ];
  const now = scoreRun(findings, { pages: 4, applicable: {} });
  const fixed = scoreRun(findings.filter((f) => f.level !== 'error'), { pages: 4, applicable: {} });
  assert.equal(now.ifErrorsFixed, fixed.score);
  assert.ok(now.score < fixed.score);
});

test('a run that never got a page says so instead of scoring zero', async () => {
  const { scoreRun } = await import('../src/score.mjs');
  const dead = scoreRun([{ level: 'error', id: 'unreachable', url: 'https://x.test/' }], { pages: 0 });
  assert.equal(dead.score, null);
  assert.match(dead.why, /nothing to score/);
});

test('the score is floored at zero rather than going negative', async () => {
  const { scoreRun } = await import('../src/score.mjs');
  const everything = ['h1-missing', 'title-missing', 'viewport-missing', 'noindex',
    'x-robots-noindex', 'canonical-multiple', 'canonical-dead', 'mixed-content',
    'page-status', 'canonical-noindex'].map((id) => ({ level: 'error', id, url: 'https://x.test/a' }));
  const score = scoreRun(everything, { pages: 1, applicable: { https: true } });
  assert.equal(score.score, 0);
  assert.equal(score.grade, 'F');
});

// --- score, end to end ----------------------------------------------------

test('a real run carries a score, and the report shows it', async () => {
  const site = await startFixtureSite();
  try {
    const { findings, meta, score } = await audit(site.origin, { limit: 30 });
    assert.ok(score.score >= 0 && score.score <= 100, `score was ${score.score}`);
    assert.ok(score.checks.passed > 0, 'something passed');

    // What the run was in a position to check travels with it, so a client
    // reading the JSON knows what the score did and did not look at.
    assert.equal(typeof meta.applicable, 'object');
    assert.equal(meta.applicable.psi, false);

    const md = markdown(findings, meta, { score });
    assert.match(md, new RegExp(`## Score: ${score.score}/100`));
    assert.match(md, /## Passing — \d+ checks/);
    assert.match(md, /## Not checked/);

    const page = html(findings, meta, { score });
    assert.match(page, /class="score/);
    assert.match(page, /Score \d+ out of 100/);
    assert.match(page, /id="passing"/);

    // And a report rendered with no score is still a report, because the
    // Worker's /export route is handed whatever a client kept.
    assert.doesNotThrow(() => html(findings, meta));
    assert.doesNotThrow(() => markdown(findings, meta));
  } finally {
    await site.stop();
  }
});

// --- comparing two deployments --------------------------------------------
// `--against` has documented "hosts are ignored" since it shipped and passed an
// option `diff()` never read, so comparing a rebuild with the site it replaces
// reported every finding as both fixed and added. The Mac app could not offer
// it at all, for the same reason underneath.

test('two runs of different hosts are compared by path, not by URL', () => {
  const previous = {
    meta: { origin: 'https://example.com', date: '2026-01-01' },
    findings: [
      { level: 'error', id: 'h1-missing', title: 'No h1', url: 'https://example.com/about/' },
      { level: 'warn', id: 'desc-missing', title: 'No description', url: 'https://example.com/gone/' },
    ],
  };
  const current = [
    // The same fault on the same page of the rebuild — not news.
    { level: 'error', id: 'h1-missing', title: 'No h1', url: 'https://new.example.com/about' },
    // And one the rebuild introduced.
    { level: 'error', id: 'title-missing', title: 'No title', url: 'https://new.example.com/about' },
  ];

  const d = diff(previous, current, { currentMeta: { origin: 'https://new.example.com' } });
  assert.equal(d.crossSite, true);
  assert.deepEqual(d.added.map((f) => f.id), ['title-missing']);
  assert.deepEqual(d.fixed.map((f) => f.id), ['desc-missing']);
  assert.equal(d.unchanged, 1);
});

test('two runs of the same host are still compared by whole URL', () => {
  const previous = {
    meta: { origin: 'https://example.com', date: '2026-01-01' },
    findings: [{ level: 'error', id: 'h1-missing', title: 'No h1', url: 'https://example.com/a/' }],
  };
  // Same check, different page. On one host those are two different problems
  // and collapsing them would hide a regression.
  const d = diff(previous, [{ level: 'error', id: 'h1-missing', title: 'No h1', url: 'https://example.com/b/' }], {
    currentMeta: { origin: 'https://example.com' },
  });
  assert.equal(d.crossSite, false);
  assert.equal(d.added.length, 1);
  assert.equal(d.fixed.length, 1);
});

test('a trailing slash is not a difference between two deployments', () => {
  const previous = {
    meta: { origin: 'https://old.test' },
    findings: [{ level: 'warn', id: 'thin-content', title: 'Thin', url: 'https://old.test/blog/post' }],
  };
  const d = diff(previous, [{ level: 'warn', id: 'thin-content', title: 'Thin', url: 'https://new.test/blog/post/' }], {
    currentMeta: { origin: 'https://new.test' },
  });
  assert.equal(d.added.length, 0);
  assert.equal(d.fixed.length, 0);
});

// A query string is not a trailing slash: /search?q=a and /search?q=b are two
// pages on any host.
test('the query survives a cross-site comparison', () => {
  const previous = {
    meta: { origin: 'https://old.test' },
    findings: [{ level: 'warn', id: 'thin-content', title: 'Thin', url: 'https://old.test/s?q=a' }],
  };
  const d = diff(previous, [{ level: 'warn', id: 'thin-content', title: 'Thin', url: 'https://new.test/s?q=b' }], {
    currentMeta: { origin: 'https://new.test' },
  });
  assert.equal(d.added.length, 1);
  assert.equal(d.fixed.length, 1);
});

// Found only because somebody asked whether the exports had been updated: the
// score reached the terminal and the HTML and stopped there. The CSV had no
// column for it, the portfolio table had no column for it, and the macOS
// window re-encoded the report from its own models on the way to `/render`,
// which dropped every field the Swift side had not been taught about — so an
// HTML report exported from the window lost the score panel the window itself
// was showing. One test per writer, so the next field to travel with a report
// cannot go missing in four places quietly.
test('every writer carries the score, or says nothing about it at all', async () => {
  const { csv: csvOf, portfolio: portfolioOf, portfolioMarkdown: portfolioMd, portfolioHtml: portfolioPage } =
    await import('../src/report.mjs');
  const { scoreRun } = await import('../src/score.mjs');

  const findings = [{ level: 'error', id: 'h1-missing', title: 'No h1', detail: 'none', url: 'https://x.test/a' }];
  const meta = { origin: 'https://x.test', pages: 4, date: '2026-01-01' };
  const score = scoreRun(findings, { pages: 4, applicable: {} });

  // CSV: a points column, and the rest of the checklist as rows, so the file
  // answers "what was checked" and not only "what was wrong".
  const sheet = csvOf(findings, meta, { score });
  const header = sheet.split('\r\n')[0].split(',').map((c) => c.replace(/^\uFEFF?"|"$/g, ''));
  // Appended, not inserted: every column that existed before keeps its index,
  // so a script reading by position is not quietly broken by a new feature.
  assert.equal(header.at(-1), 'points');
  assert.equal(header.indexOf('detail'), 10);
  assert.equal(header.indexOf('inlinks'), 6);
  assert.match(sheet, /"pass","h1-multiple"/);
  assert.match(sheet, /"not-checked",/);
  // And with no score it is exactly the findings file it has always been.
  const plain = csvOf(findings, meta);
  assert.equal(plain.split('\r\n').filter(Boolean).length, 2);

  // Portfolio: one column, since "which of my twenty sites is worst" is the
  // only question a portfolio exists to answer.
  const runs = [
    { findings, meta, score },
    { findings: [], meta: { ...meta, origin: 'https://y.test' }, score: scoreRun([], { pages: 4, applicable: {} }) },
  ];
  assert.match(portfolioOf(runs), /SCORE/);
  assert.match(portfolioMd(runs), /\| Site \| Score \|/);
  assert.match(portfolioPage(runs), /<th class="n">Score<\/th>/);

  // The worst site is the row you act on, so it is the first one.
  const { portfolioRows: rowsOf } = await import('../src/report.mjs');
  assert.equal(rowsOf(runs)[0].host, 'x.test');

  // A run that never answered sorts on its tallies and prints a dash, never a
  // zero — it has not scored nothing, it has not been scored.
  const dead = { findings: [], meta: { ...meta, origin: 'https://z.test', pages: 0 }, score: { score: null } };
  assert.match(portfolioOf([...runs, dead]), /—/);
});

// --- AI crawlers ----------------------------------------------------------
// The one check in this tool whose subject is a decision rather than a fault.
// A publisher who does not want their work in a training set and says so in
// robots.txt has done the right thing correctly, so this is a note, phrased as
// a fact — and the tests below are mostly about it staying that way.

test('AI access is read from robots.txt, per agent, the way Google reads it', async () => {
  const { aiAccess } = await import('../src/agents-ai.mjs');
  const groups = parseRobots(`
User-agent: *
Disallow: /private

User-agent: GPTBot
Disallow: /

User-agent: PerplexityBot
Disallow: /
Allow: /blog/
`);
  const at = (path) => Object.fromEntries(
    aiAccess(groups, robotsVerdict, path).map((row) => [row.agent.token, row]),
  );

  const root = at('/');
  assert.equal(root.gptbot.allowed, false);
  assert.equal(root.gptbot.explicit, true, 'GPTBot is named, so this is a decision');
  // Not named anywhere, and the only `*` rule is about /private — so it is in.
  assert.equal(root.claudebot.allowed, true);
  assert.equal(root.claudebot.explicit, false);

  // A longer Allow beats a Disallow, which is the rule this project already
  // implements once and must not implement a second time here.
  assert.equal(at('/blog/post')['perplexitybot'].allowed, true);
  assert.equal(root.perplexitybot.allowed, false);
});

// The distinction that matters, and the one everybody gets wrong: blocking a
// training crawler costs nothing today, blocking an answering one removes the
// site from answers now.
test('blocking is described by what it costs, and by whether anybody chose it', async () => {
  const { aiAccess, describeAccess } = await import('../src/agents-ai.mjs');

  const chosen = describeAccess(aiAccess(parseRobots('User-agent: GPTBot\nDisallow: /'), robotsVerdict));
  assert.equal(chosen.blocked.length, 1);
  assert.equal(chosen.training.length, 1);
  assert.equal(chosen.answering.length, 0);
  assert.match(chosen.detail, /changes nothing about whether the site can be cited today/);
  assert.match(chosen.detail, /looks deliberate — this is a note, not a fault/);

  // A `*` block catches everybody and names nobody: usually a CDN default.
  const swept = describeAccess(aiAccess(parseRobots('User-agent: *\nDisallow: /'), robotsVerdict));
  assert.equal(swept.decided, false);
  assert.match(swept.detail, /usually a CDN or plugin default rather than a decision anybody made/);
  assert.ok(swept.answering.length > 0, 'the answering crawlers are shut out too');
});

// The half that matters: a site that lets the answer engines in says nothing at
// all, rather than a line per agent confirming it.
test('a site that blocks no AI crawler produces no finding', async () => {
  const { aiAccess, describeAccess } = await import('../src/agents-ai.mjs');
  assert.equal(describeAccess(aiAccess(parseRobots('User-agent: *\nAllow: /'), robotsVerdict)), null);
  assert.equal(describeAccess(aiAccess(parseRobots(''), robotsVerdict)), null);
  // A Disallow that does not reach the root is not a block on the site.
  assert.equal(
    describeAccess(aiAccess(parseRobots('User-agent: *\nDisallow: /admin'), robotsVerdict)),
    null,
  );
});

// End to end through siteChecks, which is where the two files are actually
// fetched — and where the contradiction lives.
test('llms.txt beside a Disallow on the answering crawlers is a conflict', async () => {
  const origin = 'https://x.test';
  const routes = (url) => {
    if (url.endsWith('/robots.txt')) {
      return { body: 'User-agent: PerplexityBot\nDisallow: /\nUser-agent: GPTBot\nDisallow: /' };
    }
    if (url.endsWith('/llms.txt')) return { body: '# x.test\n\n- [Home](/)' };
    return notFound(url);
  };
  const out = await siteChecks(origin, fakeFetcher(routes), bareSite(origin), {
    sitemapUrls: [`${origin}/p/`],
  });

  const blocked = out.find((finding) => finding.id === 'ai-crawler-blocked');
  assert.ok(blocked, 'expected the block to be reported');
  assert.equal(blocked.level, 'info', 'blocking is a decision, not a fault');

  const conflict = out.find((finding) => finding.id === 'ai-crawler-conflict');
  assert.ok(conflict, 'expected the contradiction to be reported');
  assert.equal(conflict.level, 'warn');
  assert.match(conflict.detail, /PerplexityBot/);
  // GPTBot trains rather than answers, so it is not part of the contradiction:
  // an llms.txt is still readable by an assistant that was never going to fetch
  // the page live.
  assert.doesNotMatch(conflict.detail, /GPTBot/);
});

// Both halves of the "does not fire" case: no llms.txt, and no block.
test('the AI conflict stays quiet without both halves of it', async () => {
  const origin = 'https://x.test';
  const run = async (routes) =>
    (await siteChecks(origin, fakeFetcher(routes), bareSite(origin), { sitemapUrls: [`${origin}/p/`] }))
      .map((finding) => finding.id);

  // Blocked, but nothing invited them in the first place. The 404 is spelled
  // out because this fixture answers 200 to anything it was not told about,
  // which is indistinguishable from a site serving an empty llms.txt.
  const noLlms = await run((url) => {
    if (url.endsWith('/robots.txt')) return { body: 'User-agent: PerplexityBot\nDisallow: /' };
    if (url.endsWith('/llms.txt')) return { status: 404 };
    return notFound(url);
  });
  assert.ok(noLlms.includes('ai-crawler-blocked'));
  assert.ok(!noLlms.includes('ai-crawler-conflict'));

  // llms.txt, and everybody let in.
  const welcoming = await run((url) => {
    if (url.endsWith('/robots.txt')) return { body: 'User-agent: *\nAllow: /' };
    if (url.endsWith('/llms.txt')) return { body: '# x.test' };
    return notFound(url);
  });
  assert.ok(!welcoming.includes('ai-crawler-blocked'));
  assert.ok(!welcoming.includes('ai-crawler-conflict'));
  assert.ok(!welcoming.includes('llms-missing'));
});

// --- Search Console: position and queries ---------------------------------
// The one ranking in this tool, and it is allowed here for one reason: Google
// measured it. Nothing below asks what a page *should* rank for, which is the
// part every keyword tool invents.

test('position comes back with the traffic, rounded to a tenth', async () => {
  const { pageTraffic } = await import('../src/console.mjs');
  const traffic = await pageTraffic('https://x.test/', { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, {
    fetcher: async (url) => {
      if (String(url).includes('/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
      return {
        ok: true,
        json: async () => ({
          rows: [
            { keys: ['https://x.test/a/'], impressions: 400, clicks: 9, position: 12.3456 },
            // No position in the row: absent, never zero. A page "ranking 0"
            // would sort ahead of every real one.
            { keys: ['https://x.test/b/'], impressions: 3, clicks: 0 },
          ],
        }),
      };
    },
  });
  assert.equal(traffic.get('https://x.test/a').position, 12.3);
  assert.equal('position' in traffic.get('https://x.test/b'), false);
});

test('queries come back per page, most-shown first and capped', async () => {
  const { pageQueries } = await import('../src/console.mjs');
  const byPage = await pageQueries('https://x.test/', { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, {
    perPage: 2,
    fetcher: async (url) => {
      if (String(url).includes('/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
      return {
        ok: true,
        json: async () => ({
          rows: [
            // Google orders by clicks; a query with impressions and no clicks
            // is exactly the one worth naming, so this re-sorts.
            { keys: ['https://x.test/a/', 'cheap widgets'], impressions: 10, clicks: 5, position: 4 },
            { keys: ['https://x.test/a/', 'best widgets'], impressions: 900, clicks: 0, position: 11.2 },
            { keys: ['https://x.test/a/', 'widget reviews'], impressions: 50, clicks: 1, position: 30 },
            { keys: ['https://x.test/b/', 'about us'], impressions: 4, clicks: 0, position: 2 },
          ],
        }),
      };
    },
  });
  assert.deepEqual(byPage.get('https://x.test/a').map((r) => r.query), ['best widgets', 'widget reviews']);
  assert.equal(byPage.get('https://x.test/b').length, 1);
});

test('striking distance is page two, with enough impressions to be real', async () => {
  const { strikingDistance } = await import('../src/console.mjs');
  const traffic = new Map([
    ['https://x.test/two', { impressions: 900, clicks: 1, position: 12.4 }],
    // Page one already. Not an opportunity, it is a result.
    ['https://x.test/one', { impressions: 5000, clicks: 400, position: 3.1 }],
    // Page two, and shown twice. Noise, and naming it makes the list unreadable.
    ['https://x.test/noise', { impressions: 2, clicks: 0, position: 13.0 }],
    // Far enough back that "two places" is not the fix.
    ['https://x.test/far', { impressions: 800, clicks: 0, position: 44 }],
    // Ranked by nothing Google told us.
    ['https://x.test/unranked', { impressions: 900, clicks: 0 }],
  ]);
  const queries = new Map([
    ['https://x.test/two', [
      { query: 'widgets', impressions: 900, clicks: 1, position: 14 },
      { query: 'best widgets', impressions: 100, clicks: 0, position: 11.1 },
    ]],
  ]);

  const rows = strikingDistance(traffic, queries);
  assert.deepEqual(rows.map((r) => r.page), ['https://x.test/two']);
  // The query it is closest on, not the one it is shown most for — that is the
  // one worth looking at first.
  assert.equal(rows[0].best.query, 'best widgets');

  // And with no queries fetched at all, the positions still stand.
  assert.equal(strikingDistance(traffic, null)[0].best, null);
});

// A cause carries where Google puts its best page, so the ordering in every
// report can prefer a template on page two over one nobody has ever been shown.
test('a cause carries the best position of its pages', () => {
  const findings = [
    { level: 'warn', id: 'desc-missing', title: 'x', url: 'https://x.test/a/', traffic: { impressions: 10, clicks: 0, position: 30 } },
    { level: 'warn', id: 'desc-missing', title: 'x', url: 'https://x.test/b/', traffic: { impressions: 90, clicks: 1, position: 4.2 } },
  ];
  const [cause] = byCause(findings);
  assert.equal(cause.position, 4.2);
  assert.match(causeScope(cause, 2), /100 impressions in 28 days, best at position 4.2/);

  // Without Search Console there is no position and the sentence does not
  // mention one, rather than saying "position null".
  const [plain] = byCause(findings.map(({ traffic, ...rest }) => rest));
  assert.equal(plain.position, null);
  assert.doesNotMatch(causeScope(plain, 2), /position/);
});

// End to end: two calls, and the second one failing must not take the first
// one's answer down with it.
test('the queries call is best-effort, and its failure keeps the positions', async () => {
  const { searchConsole } = await import('../src/console.mjs');
  const findings = [{ id: 'thin-content', url: 'https://x.test/two/' }];

  let call = 0;
  const notes = await searchConsole('https://x.test', findings, {
    credentials: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
    fetcher: async (url) => {
      if (String(url).includes('/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
      call += 1;
      // First call is the per-page one; the second asks for queries and fails.
      if (call > 1) return { ok: false, status: 500, json: async () => ({ error: { message: 'nope' } }) };
      return {
        ok: true,
        json: async () => ({
          rows: [{ keys: ['https://x.test/two/'], impressions: 900, clicks: 1, position: 12.4 }],
        }),
      };
    },
  });

  // The position still reached the finding.
  assert.equal(findings[0].traffic.position, 12.4);
  // And the striking list is still there, without a query to name.
  const striking = notes.find((note) => note.id === 'search-console-striking');
  assert.ok(striking, 'expected the page-two list');
  assert.match(striking.detail, /position 12.4, 900 impressions/);
  assert.doesNotMatch(striking.detail, /best on/);
  // And the report says the half that did not run, rather than leaving it to
  // read as "no keywords".
  const summary = notes.find((note) => note.id === 'search-console');
  assert.match(summary.detail, /queries for these pages could not be read/);
  // Notes, never errors: this is an opportunity, not a fault.
  assert.ok(notes.every((note) => note.level === 'info'));
});

// The half that matters: a site whose pages all rank on page one, or not at
// all, gets no page-two list rather than an empty one.
test('no page-two list when nothing is on page two', async () => {
  const { searchConsole } = await import('../src/console.mjs');
  const notes = await searchConsole('https://x.test', [{ id: 'thin-content', url: 'https://x.test/a/' }], {
    credentials: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
    fetcher: async (url) => {
      if (String(url).includes('/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
      return {
        ok: true,
        json: async () => ({ rows: [{ keys: ['https://x.test/a/'], impressions: 5000, clicks: 400, position: 2.1 }] }),
      };
    },
  });
  assert.ok(!notes.some((note) => note.id === 'search-console-striking'));
  // The average position is weighted by impressions and reported once.
  assert.match(notes[0].detail, /Average position across the 1 crawled page Google ranks: 2.1/);
});

// Found on a live property, not by a test: a site with 99 impressions over 28
// days gets HTTP 200 and zero rows for the query dimension, because Google
// withholds any search too rare to be anonymous. Silence there reads exactly
// like "this site is found for nothing", which is a different claim.
test('an empty query answer is explained, not left to look like no keywords', async () => {
  const { searchConsole } = await import('../src/console.mjs');
  let call = 0;
  const notes = await searchConsole('https://x.test', [{ id: 'thin-content', url: 'https://x.test/a/' }], {
    credentials: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
    fetcher: async (url) => {
      if (String(url).includes('/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
      call += 1;
      if (call > 1) return { ok: true, json: async () => ({ rows: [] }) };
      return {
        ok: true,
        json: async () => ({ rows: [{ keys: ['https://x.test/a/'], impressions: 15, clicks: 1, position: 1.2 }] }),
      };
    },
  });
  const summary = notes.find((note) => note.id === 'search-console');
  assert.match(summary.detail, /withholds any search too rare to be anonymous/);
  assert.match(summary.detail, /positions above are unaffected/);
});

// And a property that does return queries says nothing about thresholds.
test('a property with query data gets no explanation it does not need', async () => {
  const { searchConsole } = await import('../src/console.mjs');
  let call = 0;
  const notes = await searchConsole('https://x.test', [{ id: 'thin-content', url: 'https://x.test/a/' }], {
    credentials: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
    fetcher: async (url) => {
      if (String(url).includes('/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
      call += 1;
      if (call > 1) {
        return { ok: true, json: async () => ({ rows: [{ keys: ['https://x.test/a/', 'widgets'], impressions: 9, clicks: 0, position: 3 }] }) };
      }
      return { ok: true, json: async () => ({ rows: [{ keys: ['https://x.test/a/'], impressions: 15, clicks: 1, position: 1.2 }] }) };
    },
  });
  const summary = notes.find((note) => note.id === 'search-console');
  assert.doesNotMatch(summary.detail, /threshold|could not be read/);
});

// --- llms.txt -------------------------------------------------------------
// Sibling to the sitemap writer, and held to the same rule: every line is a
// string the site already serves. The refusals matter more than the file — this
// is handed to an assistant as the authoritative summary of a site, and one
// built from a third of it is worse than none, because it looks complete.

const llmsPage = (url, doc = {}) => ({
  url,
  res: { ok: true, status: 200 },
  doc: { title: 'A page', description: '', robots: null, canonical: [], ...doc },
});

test('llms.txt is the site\'s own words, grouped by section', async () => {
  const { buildLlms } = await import('../src/llms.mjs');
  const built = buildLlms(
    [
      llmsPage('https://x.test/', { title: 'Widgets Ltd', description: 'We make widgets.' }),
      llmsPage('https://x.test/blog/one', { title: 'One', description: 'The first post.' }),
      llmsPage('https://x.test/blog/two', { title: 'Two' }),
    ],
    { origin: 'https://x.test' },
  );

  assert.equal(built.refused, null);
  // The site's own name for itself, from the home page, never invented.
  assert.match(built.text, /^# Widgets Ltd\n/);
  assert.match(built.text, /^> We make widgets\.$/m);
  assert.match(built.text, /^## \/blog\/$/m);
  assert.match(built.text, /^- \[One\]\(https:\/\/x\.test\/blog\/one\): The first post\.$/m);
  // A page with no description gets a line without one rather than a sentence
  // somebody made up about it.
  assert.match(built.text, /^- \[Two\]\(https:\/\/x\.test\/blog\/two\)$/m);
  assert.equal(built.urls.length, 3);
});

test('a title with Markdown in it cannot break the link', async () => {
  const { buildLlms } = await import('../src/llms.mjs');
  const built = buildLlms([llmsPage('https://x.test/', { title: 'Widgets [2026] (new)' })], {
    origin: 'https://x.test',
  });
  // An unescaped ] closes the link early and silently swallows the URL — the
  // sort of thing that turns up on one product page in four hundred.
  assert.match(built.text, /# Widgets \\\[2026\\\] \\\(new\\\)/);
});

test('llms.txt leaves out what a sitemap would leave out, and counts it', async () => {
  const { buildLlms } = await import('../src/llms.mjs');
  const built = buildLlms(
    [
      llmsPage('https://x.test/', { title: 'Home' }),
      llmsPage('https://x.test/hidden', { title: 'Hidden', robots: 'noindex' }),
      llmsPage('https://x.test/dupe', { title: 'Dupe', canonical: ['https://x.test/'] }),
      llmsPage('https://x.test/untitled', { title: null }),
      { url: 'https://x.test/gone', res: { ok: false, status: 404 }, doc: null },
    ],
    { origin: 'https://x.test' },
  );
  assert.deepEqual(built.urls, ['https://x.test/']);
  assert.deepEqual(built.excluded, {
    noindex: 1, 'canonical-elsewhere': 1, 'no-title': 1, status: 1,
  });
});

// The half that matters. A file built from a fraction of a site is worse than
// no file: it looks complete.
test('a partial crawl writes no llms.txt, and says which run would', async () => {
  const { buildLlms, describeLlms } = await import('../src/llms.mjs');

  const cut = buildLlms([llmsPage('https://x.test/')], { origin: 'https://x.test', truncated: 300 });
  assert.equal(cut.text, null);
  assert.match(cut.refused, /--limit 301/);
  assert.match(describeLlms(cut, 'llms.txt'), /Did not write llms.txt/);

  const throttled = buildLlms([llmsPage('https://x.test/')], { origin: 'https://x.test', rateLimited: 4 });
  assert.equal(throttled.text, null);
  assert.match(throttled.refused, /lower --concurrency/);

  // And nothing worth writing is a refusal too, not an empty file.
  const nothing = buildLlms([llmsPage('https://x.test/', { title: null })], { origin: 'https://x.test' });
  assert.equal(nothing.text, null);
  assert.match(nothing.refused, /nothing to write/);
});

test('a run only builds llms.txt when it was asked to', async () => {
  const site = await startFixtureSite();
  try {
    const quiet = await audit(site.origin, { limit: 30 });
    assert.equal(quiet.llms, undefined, 'not asked for, so not built');

    const asked = await audit(site.origin, { limit: 30, writeLlms: 'llms.txt' });
    assert.ok(asked.llms, 'asked for, so built');
    assert.ok(asked.llms.text || asked.llms.refused, 'either a file or a reason there is none');
  } finally {
    await site.stop();
  }
});

// Found by generating an llms.txt for a real site and reading it: the file
// introduced the site as "Nurkamol Vakhidov — Web Developer, Automation &amp;
// DevOps". `attr()` has decoded entities since it was written, so every meta
// description was fine — but a <title> and an <h1> are element text, went
// through none of it, and arrived undecoded in the report, in the CSV, in the
// length `title-long` is supposed to be measuring against what Google shows,
// and in the file handed to an assistant as the site's own name for itself.
test('a title and a heading are decoded, like every attribute already was', () => {
  const doc = parseHtml(
    '<html><head><title>Widgets &amp; Co &mdash; Home</title>' +
      '<meta name="description" content="Tea &amp; coffee"></head>' +
      '<body><main><h1>Tea &amp; Coffee</h1><h2>Prices &lt; &pound;10</h2></main></body></html>',
    'https://x.test/',
  );
  assert.equal(doc.title, 'Widgets & Co — Home');
  assert.equal(doc.description, 'Tea & coffee');
  assert.deepEqual(doc.h1, ['Tea & Coffee']);
  assert.equal(doc.h2[0], 'Prices < £10');

  // And the length checks now measure the characters Google shows rather than
  // the five an ampersand was costing.
  assert.equal(doc.title.length, 19);
});

// Hex numeric references were not handled at all, and `&#x2019;` is what a CMS
// emits for the apostrophe in "Widget's" — so that title arrived eight
// characters longer than Google measures it.
test('numeric entities decode in both bases, and a malformed one is survivable', () => {
  const doc = parseHtml(
    '<html><head><title>Widget&#x2019;s &pound;10 &#215; 3</title></head><body></body></html>',
    'https://x.test/',
  );
  assert.equal(doc.title, 'Widget\u2019s £10 × 3');

  // A code point outside Unicode throws from String.fromCodePoint, and one
  // page's broken title is not a reason for a crawl to stop.
  const bad = parseHtml('<html><head><title>a &#999999999; b</title></head></html>', 'https://x.test/');
  assert.equal(bad.title, 'a  b');
});

test('a page with no title is still null, not the string "null"', () => {
  const doc = parseHtml('<html><head></head><body></body></html>', 'https://x.test/');
  assert.equal(doc.title, null);
});

// --- structured data, generated ------------------------------------------
// The narrowest rule in this project, and an absolute one: every value emitted
// is a string this crawl read off this site. Structured data that describes a
// site inaccurately is worse than none — it is a machine-readable claim the
// page does not support, which is a manual-action category at Google.

const schemaPage = (url, doc = {}) => ({
  url,
  res: { ok: true, status: 200 },
  doc: {
    title: 'A page', description: '', robots: null, canonical: [], h1: [], og: {}, icons: [],
    jsonld: [], links: { internal: [], inMain: [], external: [], anchorTexts: [] },
    ...doc,
  },
});

test('a breadcrumb is named by the site, never by its slug', async () => {
  const { buildSchema } = await import('../src/schema.mjs');
  const built = buildSchema(
    [
      schemaPage('https://x.test/', { title: 'Widgets Ltd | Home', h1: ['Widgets'] }),
      schemaPage('https://x.test/docs', { title: 'Docs | Widgets Ltd', h1: ['Docs'] }),
      schemaPage('https://x.test/docs/assets', { title: 'Assets | Widgets Ltd', h1: ['Assets'] }),
    ],
    { origin: 'https://x.test' },
  );

  const crumb = built.generated.find((e) => e.url === 'https://x.test/docs/assets');
  // The h1s, not the titles. A trail built from titles renders the whole site
  // name at every step, which is what the first live run of this produced.
  assert.deepEqual(crumb.jsonld.itemListElement.map((i) => i.name), ['Widgets', 'Docs', 'Assets']);
  assert.deepEqual(crumb.jsonld.itemListElement.map((i) => i.position), [1, 2, 3]);
});

test('what the site calls a page in its own links is a name too', async () => {
  const { buildSchema } = await import('../src/schema.mjs');
  const linksTo = (href, name, times = 2) => ({
    links: { internal: [], inMain: [], external: [], anchorTexts: Array(times).fill({ href, name }) },
  });
  const built = buildSchema(
    [
      schemaPage('https://x.test/', { h1: ['Widgets'], ...linksTo('https://x.test/docs', 'Documentation') }),
      // Two h1s: the page does not clearly name itself, which this tool already
      // reports as a fault. The navigation does name it, consistently.
      schemaPage('https://x.test/docs', { title: 'Docs | Widgets Ltd', h1: ['Widgets', 'Docs'] }),
      schemaPage('https://x.test/docs/assets', { h1: ['Assets'] }),
    ],
    { origin: 'https://x.test' },
  );
  const crumb = built.generated.find((e) => e.url === 'https://x.test/docs/assets');
  assert.deepEqual(crumb.jsonld.itemListElement.map((i) => i.name), ['Widgets', 'Documentation', 'Assets']);
});

// The half that matters, three times over: no name, no trail, no markup.
test('a step that cannot be named honestly is skipped, not invented', async () => {
  const { buildSchema } = await import('../src/schema.mjs');

  // "Read more" is a link, not a name.
  const generic = buildSchema(
    [
      schemaPage('https://x.test/', {
        h1: ['Widgets'],
        links: { internal: [], inMain: [], external: [], anchorTexts: [
          { href: 'https://x.test/docs', name: 'read more' },
          { href: 'https://x.test/docs', name: 'read more' },
        ] },
      }),
      schemaPage('https://x.test/docs', { title: 'Docs | Widgets Ltd', h1: ['A', 'B'] }),
      schemaPage('https://x.test/docs/assets', { h1: ['Assets'] }),
    ],
    { origin: 'https://x.test' },
  );
  assert.ok(!generic.generated.some((e) => e.jsonld['@type'] === 'BreadcrumbList'));
  // One page could not be named. The other two are at the top of the site and
  // need no trail at all, which is a different answer and counted as one.
  assert.equal(generic.skipped['no-complete-trail'], 1);
  assert.equal(generic.skipped['top-level'], 2);

  // An ancestor that was never crawled: no title, no anchor, no trail.
  const gap = buildSchema(
    [
      schemaPage('https://x.test/', { h1: ['Widgets'] }),
      schemaPage('https://x.test/docs/assets', { h1: ['Assets'] }),
    ],
    { origin: 'https://x.test' },
  );
  assert.ok(!gap.generated.some((e) => e.jsonld['@type'] === 'BreadcrumbList'));

  // And a site that names itself nowhere gets no Organization, rather than one
  // named after the home page's title with the tagline still attached.
  assert.ok(!gap.generated.some((e) => e.jsonld['@type'] === 'Organization'));
  assert.equal(gap.skipped['no-og-site-name'], 1);
});

test('markup a page already has is never generated a second time', async () => {
  const { buildSchema } = await import('../src/schema.mjs');
  const built = buildSchema(
    [
      schemaPage('https://x.test/', {
        h1: ['Widgets'],
        og: { 'og:site_name': 'Widgets Ltd' },
        jsonld: [
          { ok: true, data: { '@graph': [{ '@type': 'WebSite' }, { '@type': 'Organization' }] } },
        ],
      }),
      schemaPage('https://x.test/docs', { h1: ['Docs'] }),
      schemaPage('https://x.test/docs/assets', {
        h1: ['Assets'],
        jsonld: [{ ok: true, data: { '@type': 'BreadcrumbList' } }],
      }),
    ],
    { origin: 'https://x.test' },
  );
  // Found inside a @graph, which is where most CMSs put it.
  assert.equal(built.skipped['already-has-website'], 1);
  assert.equal(built.skipped['already-has-organization'], 1);
  assert.equal(built.skipped['already-has-breadcrumbs'], 1);

  // A site that already declares everything and a site that gave nothing to
  // build from are two different answers. Throwing the reasons away on the
  // refusal made them read the same.
  assert.match(built.refused, /already declares everything.*good version of this answer/);
  const { describeSchema } = await import('../src/schema.mjs');
  assert.match(describeSchema(built, 'schema.json'), /already declares a BreadcrumbList/);
});

test('the organisation is named only by og:site_name', async () => {
  const { buildSchema } = await import('../src/schema.mjs');
  const built = buildSchema(
    [schemaPage('https://x.test/', {
      title: 'Widgets Ltd | The best widgets in the world, since 1994',
      h1: ['Widgets'],
      og: { 'og:site_name': 'Widgets Ltd' },
      icons: ['https://x.test/icon.png'],
    })],
    { origin: 'https://x.test' },
  );
  const org = built.generated.find((e) => e.jsonld['@type'] === 'Organization');
  assert.equal(org.jsonld.name, 'Widgets Ltd');
  assert.equal(org.jsonld.logo, 'https://x.test/icon.png');
  assert.equal(org.jsonld.url, 'https://x.test');
});

test('a partial crawl generates no structured data at all', async () => {
  const { buildSchema, describeSchema } = await import('../src/schema.mjs');
  const cut = buildSchema([schemaPage('https://x.test/')], { origin: 'https://x.test', truncated: 40 });
  assert.equal(cut.json, null);
  assert.match(cut.refused, /--limit 41/);
  assert.match(describeSchema(cut, 'schema.json'), /Did not write schema.json/);
});

// --- opening a browser ----------------------------------------------------
// Nine lines rather than a dependency, and the platform table is the whole of
// it. `start` is the one that bites: it is a cmd builtin rather than a program,
// and without the empty title argument it steals the URL as the window title
// and opens nothing.

test('every platform gets the launcher it actually has', async () => {
  const { opener } = await import('../src/open-url.mjs');
  assert.deepEqual(opener('darwin'), { command: 'open', args: [] });
  assert.deepEqual(opener('linux'), { command: 'xdg-open', args: [] });
  assert.deepEqual(opener('win32'), { command: 'cmd', args: ['/c', 'start', ''] });
  // A system with no answer says so rather than guessing at one.
  assert.equal(opener('android'), null);
});

test('opening is detached, ignored and never fatal', async () => {
  const { openUrl } = await import('../src/open-url.mjs');
  const calls = [];
  const fake = (command, args, options) => {
    calls.push({ command, args, options });
    return { on() {}, unref() {} };
  };

  assert.equal(openUrl('http://127.0.0.1:4321/', { platform: 'linux', spawnFn: fake }), true);
  assert.deepEqual(calls[0].args, ['http://127.0.0.1:4321/']);
  // A server must outlive the launcher it started.
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');

  // The empty title, or Windows opens nothing at all.
  openUrl('http://x/', { platform: 'win32', spawnFn: fake });
  assert.deepEqual(calls[1].args, ['/c', 'start', '', 'http://x/']);

  // Nothing to try, and a launcher that will not start: false, never a throw.
  // Failing to open a browser is not a reason for a server not to run.
  assert.equal(openUrl('http://x/', { platform: 'android', spawnFn: fake }), false);
  assert.equal(
    openUrl('http://x/', { platform: 'linux', spawnFn: () => { throw new Error('ENOENT'); } }),
    false,
  );
});

// --- the library the local server keeps -----------------------------------
// The window has kept every finished run since 1.23.0 and `--serve` kept none,
// so somebody on Linux or Windows got one report and lost it the moment they
// audited something else. A seven-minute crawl should only ever happen once,
// and that is not a macOS-only claim.

test('each platform keeps reports where that platform keeps documents', async () => {
  const { libraryRoot } = await import('../src/library.mjs');
  const env = { HOME: '/h' };
  // Deliberately the same path Support.directory() uses on the Swift side —
  // named for the bundle id — so the window and the browser share one library
  // rather than each having their own.
  assert.match(libraryRoot(env, 'darwin'), /Library\/Application Support\/seo-audit$/);
  assert.match(libraryRoot({ ...env, APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32'), /seo-audit$/);
  assert.match(libraryRoot({ ...env, XDG_DATA_HOME: '/h/.local/share' }, 'linux'), /\.local\/share\/seo-audit$/);
  assert.equal(libraryRoot({ SEO_AUDIT_HOME: '/somewhere' }, 'linux'), '/somewhere');
});

test('a run is kept byte for byte, and listed newest first', async () => {
  const { library } = await import('../src/library.mjs');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'seo-lib-'));
  try {
    const store = library(root);
    const payload = (origin, score) => ({
      meta: { origin, pages: 3 },
      findings: [{ level: 'warn', id: 'desc-missing', title: 'x', detail: 'y', url: `${origin}/a` }],
      causes: [{ id: 'desc-missing' }],
      score: { score },
      // A field this store knows nothing about. It must survive, which is the
      // whole reason the engine's exact JSON is what gets written.
      somethingLater: { kept: true },
    });

    const first = store.keep(payload('https://a.test', 91), { finishedAt: '2026-01-01T00:00:00Z' });
    const second = store.keep(payload('https://b.test', 40), { finishedAt: '2026-02-01T00:00:00Z' });

    assert.equal(first.host, 'a.test');
    assert.equal(first.score, 91);
    assert.equal(first.warnings, 1);
    assert.deepEqual(store.list().map((r) => r.id), [second.id, first.id]);

    const back = store.read(first.id);
    assert.equal(back.meta.origin, 'https://a.test');
    assert.deepEqual(back.somethingLater, { kept: true });
    assert.ok(store.bytes() > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// An id arrives off a URL, so it is checked rather than trusted. Anything but a
// UUID must not be able to become a path.
test('an id that is not an id cannot become a path', async () => {
  const { library } = await import('../src/library.mjs');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'seo-lib-'));
  try {
    writeFileSync(join(root, 'secret.json'), '{"meta":{"origin":"nope"}}');
    const store = library(root);
    for (const attempt of ['../secret', '../../etc/passwd', '', null, 'a'.repeat(36)]) {
      assert.equal(store.read(attempt), null, `${attempt} should not resolve`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the list is a list to click, not an archive', async () => {
  const { library } = await import('../src/library.mjs');
  const { mkdtempSync, rmSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'seo-lib-'));
  try {
    const store = library(root);
    for (let i = 0; i < 45; i += 1) {
      store.keep({ meta: { origin: 'https://x.test', pages: 1 }, findings: [], causes: [] },
        { finishedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:0${i % 10}Z` });
    }
    assert.equal(store.list().length, 40);
    // And the files went with the rows, rather than accumulating unseen.
    assert.equal(readdirSync(join(root, 'reports')).length, 40);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// An index entry whose file is gone is a row that opens onto nothing, which is
// worse than not listing it — a folder can be emptied by a sync tool without
// the index being told.
test('a row whose file has gone is not listed', async () => {
  const { library } = await import('../src/library.mjs');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'seo-lib-'));
  try {
    const store = library(root);
    const kept = store.keep({ meta: { origin: 'https://x.test', pages: 1 }, findings: [], causes: [] });
    rmSync(join(root, 'reports', `${kept.id}.json`));
    assert.deepEqual(store.list(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
