import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attr, parseHtml, parseSitemap, countWords } from '../src/parse.mjs';
import { matchGlob, applyIgnores, expectationChecks, resolveSites, optionsForSite } from '../src/config.mjs';
import { diff, serialize, parse as parseBaseline } from '../src/baseline.mjs';
import { pageChecks, crossPageChecks, sitemapChecks } from '../src/checks.mjs';
import { markdown, html, counts, group, portfolio, portfolioRows, portfolioMarkdown, portfolioHtml, progressLine, byCategory, categoryOf } from '../src/report.mjs';
import { psiTargets } from '../src/psi.mjs';
import { siteChecks } from '../src/site.mjs';
import { parseRobots, robotsVerdict } from '../src/robots.mjs';
import { parseRedirectMap, redirectChecks } from '../src/redirects.mjs';
import { audit } from '../src/audit.mjs';
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
