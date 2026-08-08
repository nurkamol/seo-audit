// Whole-site checks: the files and headers that exist once per domain, plus
// the link graph, which is the thing single-page graders can never see.
import { mapLimit } from './http.mjs';

const f = (level, id, title, detail, url) => ({ level, id, title, detail, url });

export async function siteChecks(origin, fetcher, pages, opts = {}) {
  // Every URL the sitemap listed, not only the ones this run crawled — with
  // --limit in play they are not the same set, and treating them as the same
  // reports every uncrawled page as missing from the sitemap.
  const inSitemap = new Set((opts.sitemapUrls ?? []).map((u) => u.replace(/\/$/, '')));
  const out = [];
  const base = new URL(origin);

  // --- robots.txt ---------------------------------------------------------
  const robots = await fetcher.get(new URL('/robots.txt', base).toString());
  if (!robots.ok) {
    out.push(f('warn', 'robots-missing', 'No robots.txt',
      `HTTP ${robots.status}. Not fatal, but it is where the sitemap is advertised.`, robots.url));
  } else {
    if (/^\s*disallow:\s*\/\s*$/im.test(robots.body) && /user-agent:\s*\*/i.test(robots.body)) {
      out.push(f('error', 'robots-blocks-all', 'robots.txt blocks the whole site',
        'Disallow: / for User-agent: *. Nothing will be indexed.', robots.url));
    }
    if (!/sitemap:/i.test(robots.body)) {
      out.push(f('info', 'robots-no-sitemap', 'robots.txt does not list a sitemap',
        'One line, and every crawler finds the sitemap without guessing.', robots.url));
    }
  }

  // --- llms.txt -----------------------------------------------------------
  const llms = await fetcher.get(new URL('/llms.txt', base).toString());
  if (!llms.ok) {
    out.push(f('info', 'llms-missing', 'No llms.txt',
      'The emerging convention for telling AI assistants what a site is and which pages matter.', llms.url));
  }

  // --- Canonical host and scheme -----------------------------------------
  // One hop is right. Two means every visitor pays for a wasted round trip.
  const host = base.host.replace(/^www\./, '');
  const variants = [`http://${host}/`, `https://www.${host}/`, `http://www.${host}/`];
  for (const variant of variants) {
    const { hops, final } = await fetcher.chain(variant);
    if (!final.ok) {
      out.push(f('warn', 'host-variant-dead', `${variant} does not resolve to a page`,
        final.error ? `Request failed: ${final.error}` : `Ends at HTTP ${final.status}`, variant));
    } else if (hops.length > 2) {
      out.push(f('warn', 'redirect-chain', `${variant} takes ${hops.length - 1} redirects`,
        hops.map((h) => `${h.status} ${h.url}`).join(' → '), variant));
    }
  }

  // --- Security headers ---------------------------------------------------
  const home = await fetcher.get(base.origin + '/');
  const header = (name) => home.headers.get(name);
  const expected = [
    ['strict-transport-security', 'warn', 'HSTS not set', 'Browsers will try HTTP first on the next visit.'],
    ['x-content-type-options', 'info', 'X-Content-Type-Options not set', 'nosniff stops MIME-type guessing.'],
    ['referrer-policy', 'info', 'Referrer-Policy not set', 'Full URLs leak to third parties by default.'],
    ['content-security-policy', 'info', 'No Content-Security-Policy', 'The strongest defence against injected scripts.'],
  ];
  for (const [name, level, title, detail] of expected) {
    if (!header(name)) out.push(f(level, `header-${name}`, title, detail, home.url));
  }

  // --- Broken internal links ---------------------------------------------
  // Every internal href on every crawled page, checked once.
  const known = new Set(pages.map((p) => p.url.replace(/\/$/, '')));
  // Cloudflare rewrites mailto: links to /cdn-cgi/l/email-protection, which
  // answers 404 to anything that is not a browser running their script. It is
  // not a broken link, it is an anti-spam measure working as designed.
  const notReallyBroken = /\/cdn-cgi\//;
  const seen = new Map(); // target → pages linking to it
  for (const page of pages) {
    for (const href of page.doc?.links.internal ?? []) {
      const clean = href.split('#')[0];
      const bare = clean.replace(/\/$/, '');
      if (known.has(bare) || inSitemap.has(bare) || notReallyBroken.test(clean)) continue;
      seen.set(clean, [...(seen.get(clean) ?? []), page.url]);
    }
  }
  const targets = [...seen.keys()].slice(0, opts.maxLinkChecks ?? 200);
  await mapLimit(targets, 6, async (target) => {
    const res = await fetcher.get(target);
    if (res.status === 404 || res.status === 0) {
      out.push(f('error', 'broken-link', 'Link to a page that does not exist',
        `${target} — linked from ${seen.get(target).slice(0, 3).join(', ')}`, seen.get(target)[0]));
    }
  });

  // Linked, reachable, and absent from the sitemap — the mirror image of an
  // orphan, and just as easy to ship by accident when a route is added.
  const missing = new Map();
  for (const [target, sources] of seen) {
    const res = await fetcher.get(target);
    if (res.status === 200 && /text\/html/i.test(res.headers.get('content-type') ?? '')) {
      missing.set(target, sources);
    }
  }
  for (const [target, sources] of [...missing].slice(0, 20)) {
    out.push(f('warn', 'missing-from-sitemap', 'Page is linked but not in the sitemap',
      `${target} — linked from ${sources.slice(0, 2).join(', ')}`, target));
  }

  // --- Canonical targets --------------------------------------------------
  // A canonical pointing at a redirect or a 404 is worse than none: Google is
  // told the real page lives somewhere that does not answer.
  const canonicals = new Map();
  for (const page of pages) {
    const target = page.doc?.canonical?.[0];
    if (!target) continue;
    if (target.replace(/\/$/, '') === page.url.replace(/\/$/, '')) continue;
    canonicals.set(target, page.url);
  }
  await mapLimit([...canonicals.keys()], 4, async (target) => {
    const res = await fetcher.get(target);
    if (res.status >= 300 && res.status < 400) {
      out.push(f('error', 'canonical-redirects', 'Canonical points at a redirect',
        `${target} answers ${res.status}. Point it at the final URL.`, canonicals.get(target)));
    } else if (!res.ok) {
      out.push(f('error', 'canonical-dead', 'Canonical points at a page that does not load',
        `${target} answers ${res.status}.`, canonicals.get(target)));
    }
  });

  // --- Trailing slashes ---------------------------------------------------
  // Both forms serving 200 is two URLs for one page, and Google will pick one
  // for you. A redirect between them is correct; two live copies are not.
  const sample = pages.filter((p) => p.res.ok && new URL(p.url).pathname !== '/').slice(0, 12);
  let inconsistent = 0;
  await mapLimit(sample, 4, async (page) => {
    const url = new URL(page.url);
    const flipped = url.pathname.endsWith('/')
      ? page.url.replace(/\/$/, '')
      : `${page.url}/`;
    const res = await fetcher.get(flipped);
    if (res.status === 200) inconsistent++;
  });
  if (inconsistent) {
    out.push(f('warn', 'trailing-slash', 'Pages answer with and without a trailing slash',
      `${inconsistent} of ${sample.length} sampled pages load both ways, which is two URLs for one page. ` +
        'One form should redirect to the other.', origin));
  }

  // --- Social images actually load ---------------------------------------
  const ogImages = new Map();
  for (const page of pages) {
    const src = page.doc?.og['og:image'];
    if (src) ogImages.set(src, page.url);
  }
  await mapLimit([...ogImages.keys()], 4, async (src) => {
    const res = await fetcher.get(src, { method: 'HEAD' });
    if (!res.ok) {
      out.push(f('error', 'og-image-broken', 'og:image does not load',
        `HTTP ${res.status} for ${src} — shared links will preview blank.`, ogImages.get(src)));
      return;
    }
    const bytes = Number(res.headers.get('content-length') ?? 0);
    if (bytes > 5_000_000) {
      out.push(f('warn', 'og-image-heavy', 'og:image is very large',
        `${(bytes / 1e6).toFixed(1)}MB — some scrapers give up before downloading it.`, ogImages.get(src)));
    }
  });

  return out;
}
