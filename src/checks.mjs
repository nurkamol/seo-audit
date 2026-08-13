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

// --- Alt text ---------------------------------------------------------------
// An alt that is really a filename — what a CMS fills in when nobody typed
// anything. `.jpg` at the end, or the shape a camera and a phone both produce.
const ALT_FILENAME = /\.(jpe?g|png|gif|webp|svg|avif)$/i;
const ALT_SERIAL = /^(img|dsc|dscn|pxl|photo|image|screenshot|untitled)[-_ ]?\d+$/i;

// Words that name the medium rather than the content. A screen reader already
// announces "image" before reading the alt, so alt="image" says it twice and
// tells nobody anything.
const ALT_PLACEHOLDER = new Set([
  'image', 'photo', 'picture', 'img', 'icon', 'logo', 'graphic', 'banner',
  'thumbnail', 'untitled', 'alt', 'alt text', 'image of', 'photo of',
  'spacer', 'placeholder', 'no alt', 'none',
]);

// A screen reader reads alt in one breath, with no way to skim or pause.
const ALT_MAX = 125;

// --- hreflang ---------------------------------------------------------------
// A language, optionally a script, optionally a region, joined by hyphens:
// en, en-GB, zh-Hant, zh-Hant-TW, en-419. Case is not significant to Google.
// Only the shape is checked, not whether the codes exist — that would mean
// embedding the ISO lists, and a wrong list is worse than no check. The shape
// alone catches the common mistake, which is an underscore.
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i;
const isLanguageTag = (tag) =>
  (tag ?? '').toLowerCase() === 'x-default' || LANGUAGE_TAG.test(tag ?? '');

// Compare languages, not dialects: a page declaring lang="en-US" and hreflang
// "en" agrees with itself. Only the primary subtag is the claim about language.
const primaryLanguage = (tag) => (tag ?? '').split('-')[0].toLowerCase();

const withoutSlash = (u) => (u ?? '').replace(/\/$/, '');

// Two images sharing alt text is a judgement call — a gallery of near-identical
// product shots is a fair reason. A whole page of them is a template nobody
// filled in, so only report from three up.
const ALT_DUP_MIN = 3;

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
  // The same instruction, sent as a header. Nothing in the HTML shows it, so it
  // survives every review of the markup and every tool that only reads the
  // source — while binding Google exactly as hard as the meta tag.
  const xRobots = res.headers?.get?.('x-robots-tag') ?? '';
  if (/noindex/i.test(xRobots)) {
    out.push(f('error', 'x-robots-noindex', 'Page is noindexed by an HTTP header',
      `X-Robots-Tag: "${xRobots}" — invisible in the HTML, and the page is in the sitemap.`, url));
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
  // The Open Graph spec requires an absolute URL. A scraper has no page context
  // to resolve `/og.jpg` against, so the preview comes out blank — and the
  // markup looks perfectly reasonable to anyone reading it. Protocol-relative
  // is tolerated here because scrapers do in fact resolve it.
  if (ogImage && !/^(https?:)?\/\//i.test(ogImage)) {
    out.push(f('error', 'og-image-relative', 'og:image is not an absolute URL',
      `"${ogImage}" — Open Graph requires a full URL including the host. Shared links will preview blank.`, url));
  }
  if (ogImage && /\.webp($|\?)/i.test(ogImage)) {
    out.push(f('warn', 'og-webp', 'og:image is WebP',
      'LinkedIn does not render WebP previews and WhatsApp is unreliable with it. Use JPEG or PNG.', url));
  }
  if (ogImage && !doc.og['og:image:width']) {
    out.push(f('info', 'og-no-dimensions', 'og:image has no declared width/height',
      'Scrapers guess, and some skip the preview rather than guess.', url));
  }

  // --- hreflang -----------------------------------------------------------
  // Reciprocity is checked across pages, in crossPageChecks. What is checkable
  // from the page alone is whether the annotation is well formed and whether
  // the page agrees with it about what the page is.
  if (doc.hreflang.length) {
    const malformed = doc.hreflang.filter((alt) => !isLanguageTag(alt.lang));
    for (const alt of malformed) {
      out.push(f('error', 'hreflang-invalid', `Malformed hreflang code: "${alt.lang}"`,
        'Google ignores an annotation it cannot parse, so this version is invisible to it. The form is ' +
          'a language, optionally a script and a region, joined by hyphens — en, en-GB, zh-Hant-TW. ' +
          'An underscore instead of a hyphen is the usual cause.', url));
    }

    // Every version has to list itself alongside the others, or the set is
    // incomplete and Google may discard all of it.
    const self = doc.hreflang.find((alt) => alt.href && withoutSlash(alt.href) === withoutSlash(url));
    if (!self) {
      out.push(f('warn', 'hreflang-no-self', 'hreflang does not list this page',
        `It points at ${doc.hreflang.map((a) => a.lang).join(', ')} but never at itself. A version that ` +
          'omits its own self-reference leaves the set incomplete.', url));
    } else if (doc.lang && primaryLanguage(self.lang) !== primaryLanguage(doc.lang)) {
      // The page's two statements about its own language, disagreeing. This is
      // only ever visible on a translated page, which is the kind of page a
      // homepage grader never opens.
      out.push(f('warn', 'hreflang-lang-mismatch', 'The page disagrees with its own hreflang about its language',
        `<html lang="${doc.lang}"> but hreflang calls this page "${self.lang}". Google reads both, and one ` +
          'of them is wrong — usually a template that hardcodes lang while the annotation is generated.', url));
    }
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
  // Alt text that exists but says nothing. alt="" is deliberate and correct for
  // a decorative image, so it is never judged here — only text a screen reader
  // would actually read out.
  const described = doc.images.filter((i) => i.alt);
  const norm = (i) => i.alt.trim().toLowerCase().replace(/[.:,;!?—–-]+$/, '');

  const filename = described.filter((i) => ALT_FILENAME.test(i.alt.trim()) || ALT_SERIAL.test(i.alt.trim()));
  if (filename.length) {
    out.push(f('warn', 'img-alt-filename', `${filename.length} image(s) with a filename as alt text`,
      `First: alt="${filename[0].alt}" on ${filename[0].src}. That is what a CMS fills in when nobody typed anything — it describes the file, not the picture.`, url));
  }

  const placeholder = described.filter((i) => ALT_PLACEHOLDER.has(norm(i)));
  if (placeholder.length) {
    out.push(f('warn', 'img-alt-placeholder', `${placeholder.length} image(s) with placeholder alt text`,
      `First: alt="${placeholder[0].alt}" on ${placeholder[0].src}. It names the medium, not the content — a screen reader already announces "image" before reading it.`, url));
  }

  // Counted over what is left, because a filename or a placeholder repeated on
  // every image is already reported above, with a more useful message.
  const flagged = new Set([...filename, ...placeholder]);
  const repeats = new Map();
  for (const i of described.filter((i) => !flagged.has(i))) {
    repeats.set(norm(i), [...(repeats.get(norm(i)) ?? []), i]);
  }
  for (const [alt, group] of repeats) {
    if (group.length >= ALT_DUP_MIN) {
      out.push(f('info', 'img-alt-duplicate', `${group.length} images share one alt text`,
        `"${alt}" — fair for near-identical product shots, a template nobody filled in otherwise. Each image earns its own description.`, url));
    }
  }

  const longAlt = described.filter((i) => i.alt.length > ALT_MAX);
  if (longAlt.length) {
    out.push(f('info', 'img-alt-long', `${longAlt.length} image(s) with very long alt text`,
      `First: ${longAlt[0].alt.length} chars on ${longAlt[0].src}. Alt is read in one breath, with no way to skim — a description this long belongs in the page text, where everyone gets it.`, url));
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

  // x-default names the version to serve someone whose language matches none of
  // the others. Reported once for the whole site rather than on every page,
  // because on a translated site the answer is the same on all of them.
  const translated = live.filter((p) => p.doc.hreflang.length);
  if (translated.length) {
    const hasDefault = translated.some((p) =>
      p.doc.hreflang.some((alt) => (alt.lang ?? '').toLowerCase() === 'x-default'),
    );
    if (!hasDefault) {
      out.push(f('info', 'hreflang-no-x-default', 'No x-default in the hreflang set',
        `${translated.length} pages declare alternates and none names an x-default — the version to serve ` +
          'a visitor whose language matches none of the others. Usually the English or the country selector.',
        translated[0].url));
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
