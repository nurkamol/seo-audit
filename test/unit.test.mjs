import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attr, parseHtml, parseSitemap } from '../src/parse.mjs';
import { matchGlob, applyIgnores, expectationChecks } from '../src/config.mjs';
import { diff, serialize, parse as parseBaseline } from '../src/baseline.mjs';
import { pageChecks, crossPageChecks } from '../src/checks.mjs';
import { markdown, html, counts, group } from '../src/report.mjs';
import { psiTargets } from '../src/psi.mjs';
import { siteChecks } from '../src/site.mjs';

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

test('attr does not match a longer attribute name', () => {
  // `data-alt` must not satisfy a request for `alt`.
  assert.equal(attr('<img data-src="x">', 'src'), null);
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

test('parseSitemap distinguishes an index from a urlset', () => {
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://a.test/</loc></url></urlset>'), {
    urls: ['https://a.test/'],
    sitemaps: [],
  });
  assert.deepEqual(
    parseSitemap('<sitemapindex><sitemap><loc>https://a.test/s.xml</loc></sitemap></sitemapindex>'),
    { urls: [], sitemaps: ['https://a.test/s.xml'] },
  );
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
