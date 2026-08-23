import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attr, parseHtml, parseSitemap, countWords } from '../src/parse.mjs';
import { matchGlob, applyIgnores, expectationChecks, resolveSites, optionsForSite } from '../src/config.mjs';
import { diff, serialize, parse as parseBaseline } from '../src/baseline.mjs';
import { pageChecks, crossPageChecks, sitemapChecks, seriesOf } from '../src/checks.mjs';
import { byCause, causeScope, sectionOf } from '../src/causes.mjs';
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

test('parsing a non-report JSON file explains itself', () => {
  assert.throws(() => parseBaseline('{"hello":true}', 'x.json'), /no findings array/);
  assert.throws(() => parseBaseline('not json', 'x.json'), /not valid JSON/);
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
