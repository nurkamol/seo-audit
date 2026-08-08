// The checks.
//
// Scope: correctness that holds across every page of a site. Performance is
// never *estimated* here — see src/psi.mjs, which asks Google for the real
// measurement instead. What this covers is the layer single-page graders skip:
// they audit one URL, and the problems that matter usually live on page 23.
//
// A finding is { id, level, title, detail, url }.
//   error — wrong, and costs traffic or breaks something
//   warn  — worth fixing, judgement involved
//   info  — worth knowing, may be deliberate

// Defaults, overridable per site under `limits` in the config file. A
// documentation site and a shop disagree about what "thin" means, and the tool
// should not hold the opinion.
export const DEFAULT_LIMITS = {
  titleMin: 15,
  titleMax: 60,
  descMin: 70,
  descMax: 160,
  thinWords: 300,
  slowMs: 800,
};

const f = (level, id, title, detail, url) => ({ level, id, title, detail, url });

/** Checks that only need the page itself. */
export function pageChecks(page, limits = DEFAULT_LIMITS) {
  const LIMITS = { ...DEFAULT_LIMITS, ...limits };
  const { url, res, doc } = page;
  const out = [];

  if (res.status >= 300 && res.status < 400) {
    out.push(
      f('error', 'sitemap-redirect', 'Sitemap URL redirects',
        `${res.status} → ${res.location}. A sitemap should list final URLs only.`, url),
    );
    return out;
  }
  if (!res.ok) {
    out.push(f('error', 'page-status', 'Page did not return 200',
      res.error ? `Request failed: ${res.error}` : `HTTP ${res.status}`, url));
    return out;
  }
  if (!doc) return out;

  // --- Indexability -------------------------------------------------------
  if (/noindex/i.test(doc.robots ?? '')) {
    out.push(f('error', 'noindex', 'Page is noindexed but listed in the sitemap',
      `robots meta: "${doc.robots}"`, url));
  }

  // --- Title & description ------------------------------------------------
  if (!doc.title) {
    out.push(f('error', 'title-missing', 'No <title>', 'Every page needs one.', url));
  } else if (doc.title.length > LIMITS.titleMax) {
    out.push(f('warn', 'title-long', 'Title may be truncated in results',
      `${doc.title.length} chars (aim for under ${LIMITS.titleMax}): "${doc.title}"`, url));
  } else if (doc.title.length < LIMITS.titleMin) {
    out.push(f('warn', 'title-short', 'Title is very short',
      `${doc.title.length} chars: "${doc.title}"`, url));
  }

  if (!doc.description) {
    out.push(f('warn', 'desc-missing', 'No meta description',
      'Google will invent one from the page text.', url));
  } else if (doc.description.length > LIMITS.descMax) {
    out.push(f('warn', 'desc-long', 'Meta description will be cut off',
      `${doc.description.length} chars (limit ~${LIMITS.descMax})`, url));
  } else if (doc.description.length < LIMITS.descMin) {
    out.push(f('info', 'desc-short', 'Meta description is short',
      `${doc.description.length} chars — room to say more.`, url));
  }

  // --- Structure ----------------------------------------------------------
  if (doc.h1.length === 0) out.push(f('error', 'h1-missing', 'No <h1>', 'The page has no headline.', url));
  else if (doc.h1.length > 1) {
    out.push(f('warn', 'h1-multiple', 'More than one <h1>',
      `${doc.h1.length} found: ${doc.h1.slice(0, 3).map((h) => `"${h}"`).join(', ')}`, url));
  }
  if (!doc.lang) out.push(f('warn', 'lang-missing', 'No lang attribute on <html>', 'Screen readers and Google both use it.', url));
  if (!doc.viewport) out.push(f('error', 'viewport-missing', 'No viewport meta', 'The page will not render correctly on phones.', url));

  // --- Canonical ----------------------------------------------------------
  if (doc.canonical.length === 0) {
    out.push(f('warn', 'canonical-missing', 'No canonical link', 'Duplicate URLs will compete with each other.', url));
  } else if (doc.canonical.length > 1) {
    out.push(f('error', 'canonical-multiple', 'Several canonical links',
      `Google ignores all of them when they conflict: ${doc.canonical.join(', ')}`, url));
  } else if (doc.canonical[0].replace(/\/$/, '') !== url.replace(/\/$/, '')) {
    out.push(f('info', 'canonical-other', 'Canonical points elsewhere',
      `→ ${doc.canonical[0]} (deliberate for a duplicate, a problem otherwise)`, url));
  }

  // --- Social -------------------------------------------------------------
  for (const tag of ['og:title', 'og:description', 'og:image']) {
    if (!doc.og[tag]) out.push(f('warn', 'og-missing', `Missing ${tag}`,
      'Shared links will preview with whatever the platform scrapes.', url));
  }
  const ogImage = doc.og['og:image'];
  if (ogImage && /\.webp($|\?)/i.test(ogImage)) {
    out.push(f('warn', 'og-webp', 'og:image is WebP',
      'LinkedIn does not render WebP previews and WhatsApp is unreliable with it. Use JPEG or PNG.', url));
  }
  if (ogImage && !doc.og['og:image:width']) {
    out.push(f('info', 'og-no-dimensions', 'og:image has no declared width/height',
      'Scrapers guess, and some skip the preview rather than guess.', url));
  }

  // --- Structured data ----------------------------------------------------
  for (const block of doc.jsonld) {
    if (!block.ok) {
      out.push(f('error', 'jsonld-invalid', 'Structured data is not valid JSON', block.error, url));
      continue;
    }
    const data = block.data;
    const hasType = (n) => n && (n['@type'] || Array.isArray(n['@graph']));
    if (!hasType(data)) {
      out.push(f('warn', 'jsonld-no-type', 'Structured data has no @type',
        'A block without a type tells Google nothing.', url));
    }
  }

  // --- Images -------------------------------------------------------------
  const noAlt = doc.images.filter((i) => i.alt === null);
  if (noAlt.length) {
    out.push(f('error', 'img-alt', `${noAlt.length} image(s) with no alt attribute`,
      `First: ${noAlt[0].src}. Decorative images need alt="" — the attribute must exist either way.`, url));
  }
  const noDim = doc.images.filter((i) => i.src && (!i.width || !i.height));
  if (noDim.length) {
    out.push(f('warn', 'img-dimensions', `${noDim.length} image(s) without width/height`,
      `First: ${noDim[0].src}. Without them the page reflows as images arrive (layout shift).`, url));
  }
  const noSrcset = doc.images.filter((i) => i.src && !i.srcset && !i.inPicture && !/\.svg($|\?)/i.test(i.src));
  if (noSrcset.length) {
    out.push(f('info', 'img-srcset', `${noSrcset.length} image(s) served at one size`,
      `First: ${noSrcset[0].src}. A phone downloads the desktop file.`, url));
  }

  // --- Content ------------------------------------------------------------
  if (doc.words < LIMITS.thinWords) {
    out.push(f('warn', 'thin-content', 'Thin page',
      `${doc.words} words. Under ~${LIMITS.thinWords} rarely ranks for anything competitive.`, url));
  }
  if (doc.links.inMain.length === 0) {
    out.push(f('info', 'no-editorial-links', 'No links inside the content',
      'Only navigation links out of this page — nothing passes authority to related pages.', url));
  }

  // --- Heading order ------------------------------------------------------
  // A jump from h1 to h3 is how a screen-reader user loses the shape of a
  // page, and how a search engine loses the outline of the argument.
  const levels = doc.headingLevels ?? [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      out.push(f('warn', 'heading-skip', `Heading level jumps from h${levels[i - 1]} to h${levels[i]}`,
        'Headings should descend one level at a time — the outline is a structure, not a size chart.', url));
      break;
    }
  }

  // --- URL hygiene --------------------------------------------------------
  const path = new URL(url).pathname;
  if (/[A-Z]/.test(path)) {
    out.push(f('warn', 'url-uppercase', 'URL contains uppercase letters',
      `${path} — servers usually treat case as significant, so this invites duplicate URLs.`, url));
  }
  if (path.includes('_')) {
    out.push(f('info', 'url-underscore', 'URL uses underscores',
      `${path} — Google reads hyphens as word separators and underscores as joins.`, url));
  }
  if (/%20|\s/.test(path)) {
    out.push(f('warn', 'url-space', 'URL contains spaces', path, url));
  }

  // --- Head essentials ----------------------------------------------------
  if (doc.charset === null) {
    out.push(f('warn', 'charset-missing', 'No character encoding declared',
      'Without it the browser guesses, and guesses wrongly on non-Latin text.', url));
  }

    // --- Mixed content ------------------------------------------------------
  if (url.startsWith('https://')) {
    const insecure = [...(page.html ?? '').matchAll(/(?:src|href)="(http:\/\/[^"]+)"/gi)]
      .map((m) => m[1])
      .filter((u) => !u.startsWith('http://localhost'));
    if (insecure.length) {
      out.push(f('error', 'mixed-content', 'Insecure resources on an HTTPS page',
        `${insecure.length}, first: ${insecure[0]}`, url));
    }
  }

  if (res.ms > LIMITS.slowMs) {
    out.push(f('info', 'slow', 'Slow response',
      `${res.ms}ms to first byte from this machine. Measure properly with WebPageTest.`, url));
  }

  return out;
}

/** Checks that need every page at once. */
export function crossPageChecks(pages) {
  const out = [];
  const live = pages.filter((p) => p.doc && p.res.ok);

  const groupBy = (key) => {
    const map = new Map();
    for (const p of live) {
      const value = p.doc[key];
      if (!value) continue;
      map.set(value, [...(map.get(value) ?? []), p.url]);
    }
    return [...map].filter(([, urls]) => urls.length > 1);
  };

  for (const [title, urls] of groupBy('title')) {
    out.push(f('warn', 'duplicate-title', 'Same title on several pages',
      `"${title}" — ${urls.length} pages: ${urls.slice(0, 4).join(', ')}`, urls[0]));
  }
  for (const [desc, urls] of groupBy('description')) {
    out.push(f('warn', 'duplicate-description', 'Same meta description on several pages',
      `${urls.length} pages: ${urls.slice(0, 4).join(', ')}`, urls[0]));
  }

  // A page nothing links to is a page Google reaches only because the sitemap
  // mentions it — it inherits no internal authority and reads as an
  // afterthought. Home is exempt: it is linked from outside, not from within.
  const linkedTo = new Set();
  for (const p of live) {
    for (const href of p.doc.links.internal) linkedTo.add(href.split('#')[0].replace(/\/$/, ''));
  }
  for (const p of live) {
    const isHome = new URL(p.url).pathname.replace(/\/$/, '') === '';
    if (!isHome && !linkedTo.has(p.url.replace(/\/$/, ''))) {
      out.push(f('warn', 'orphan-page', 'Nothing links to this page',
        'It is in the sitemap, but no other page links to it — so it collects no internal authority.', p.url));
    }
  }

  // hreflang has to point both ways, or Google ignores the pair.
  const byUrl = new Map(live.map((p) => [p.url.replace(/\/$/, ''), p]));
  for (const p of live) {
    for (const alt of p.doc.hreflang) {
      if (!alt.href || alt.lang === 'x-default') continue;
      const target = byUrl.get(alt.href.replace(/\/$/, ''));
      if (!target) continue; // outside the crawl — cannot judge
      const returns = target.doc.hreflang.some(
        (a) => a.href && a.href.replace(/\/$/, '') === p.url.replace(/\/$/, ''),
      );
      if (!returns) {
        out.push(f('error', 'hreflang-one-way', 'hreflang is not reciprocal',
          `${p.url} → ${alt.href} (${alt.lang}), but the target does not link back. Google drops one-way pairs.`, p.url));
      }
    }
  }

  return out;
}
