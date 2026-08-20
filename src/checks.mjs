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

import { attr, stripMarkupInAttributes } from './parse.mjs';

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
  maxClickDepth: 4,
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

// --- Anchor text ------------------------------------------------------------
// Words that describe the act of clicking rather than what is on the other
// side. Deliberately short and unarguable: every entry here is a phrase that
// would be identical on any link on any site, which is the whole complaint.
// "Get started", "Book now" and "Download the guide" are not on it — they say
// something about the destination, and a list that grows opinions instead of
// facts becomes a list that argues with people.
const GENERIC_ANCHORS = new Set([
  'read more', 'read the rest', 'continue reading', 'more', 'more info',
  'more information', 'learn more', 'find out more', 'click here', 'click',
  'here', 'this', 'this page', 'this link', 'link', 'view', 'view more',
  'see more', 'details', 'go', 'open',
]);

const anchorPhrase = (name) =>
  (name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

// Below this a response is not worth compressing and plenty of CDNs skip it.
const COMPRESSIBLE_FROM = 5 * 1024;
// Deliberately far above anything ordinary. Google's own limit is 15MB, so this
// is a signal rather than a threshold — and set high enough that a page has to
// be genuinely extraordinary to trip it.
const HUGE_HTML = 1024 * 1024;

// --- Structured data --------------------------------------------------------
// Google's documented requirements, for the types people actually ship and only
// the fields that have been stable for years. A rich result is refused outright
// when one is missing and nothing on the page says so — the markup validates,
// the type is right, and the result never appears.
//
// Deliberately short. Google's requirements move, and a list that goes stale
// invents findings on correct markup, which is the one failure this tool cannot
// afford. Anything uncertain is left out rather than guessed at.
const SCHEMA_REQUIRED = {
  Article: ['headline'],
  NewsArticle: ['headline'],
  BlogPosting: ['headline'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
  Event: ['name', 'startDate', 'location'],
  Organization: ['name'],
  LocalBusiness: ['name', 'address'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate'],
  Recipe: ['name', 'image'],
};

// A Product needs a name and something to show: Google will not render a product
// result with no price, no review and no rating.
const PRODUCT_ONE_OF = ['offers', 'review', 'aggregateRating'];

/** Every node in a JSON-LD block that declares a type, references excluded.
 *
 *  A node carrying `@id` and little else is a pointer to a definition made
 *  elsewhere — `"publisher": { "@id": "…#org" }` — not an incomplete node. */
export function schemaNodes(blocks) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const isReference = node['@id'] && Object.keys(node).length <= 2;
    if (node['@type'] && !isReference) found.push(node);
    for (const value of Object.values(node)) walk(value);
  };
  for (const block of blocks ?? []) if (block.ok) walk(block.data);
  return found;
}

const present = (value) =>
  value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);

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

  // nofollow on the page tells Google to follow none of its links — every one
  // of them, including the navigation. On a page that exists to lead somewhere
  // that is a dead end, and it is far less often deliberate than noindex.
  const robotsDirectives = `${doc.robots ?? ''} ${xRobots}`;
  if (/(^|[\s,])nofollow([\s,]|$)/i.test(robotsDirectives)) {
    const alsoNoindex = /noindex/i.test(robotsDirectives);
    out.push(f('warn', 'nofollow-page', alsoNoindex ? 'Page is noindex and nofollow' : 'Page is nofollow',
      alsoNoindex
        ? `"${robotsDirectives.trim()}" — nothing here is indexed and no link out of it is followed, so this ` +
          'page is a full stop for a crawler. Deliberate for a private area; a mistake on anything else.'
        : `"${robotsDirectives.trim()}" — Google will follow none of the links on this page, navigation ` +
          'included, so everything it links to loses that path in.', url));
  }

  // Two sources for the same instruction, disagreeing. Google resolves it by
  // taking the most restrictive, so the page ends up doing what neither author
  // intended — and whichever file you are reading tells you the wrong story.
  const metaSays = (doc.robots ?? '').toLowerCase();
  const headerSays = xRobots.toLowerCase();
  if (metaSays && headerSays) {
    const conflicts = [
      ['index', /\bnoindex\b/, /(^|[\s,])index([\s,]|$)/],
      ['follow', /\bnofollow\b/, /(^|[\s,])follow([\s,]|$)/],
    ]
      .filter(([, negative, positive]) =>
        (negative.test(metaSays) && positive.test(headerSays)) ||
        (negative.test(headerSays) && positive.test(metaSays)))
      .map(([name]) => name);
    if (conflicts.length) {
      out.push(f('warn', 'robots-conflict', 'The robots meta tag and the header disagree',
        `meta: "${doc.robots}" · X-Robots-Tag: "${xRobots}" — they contradict each other on ` +
          `${conflicts.join(' and ')}. Google takes the most restrictive of the two, so the page does ` +
          'what neither file says on its own.', url));
    }
  }

  // A meta refresh is a redirect nothing treats as one: it costs a render, it
  // passes signals poorly, and a visitor sees the wrong page first.
  if (doc.refresh && /url=/i.test(doc.refresh)) {
    const [seconds] = doc.refresh.split(';');
    const to = doc.refresh.match(/url=\s*['"]?([^'";\s]+)/i)?.[1] ?? '';
    out.push(f('warn', 'meta-refresh', 'Page redirects with a meta refresh',
      `"${doc.refresh}" → ${to}. A 301 says the same thing to a crawler in one hop and passes the ` +
        `signals properly.${Number(seconds) > 0 ? ' A delay also shows the visitor a page you did not mean them to read.' : ''}`,
      url));
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
  else {
    // The tag is there, so nothing reports it — but what it *says* is read by
    // nobody until a phone renders the page. Two of its settings are checked
    // here, both facts rather than preferences.
    const viewport = Object.fromEntries(
      doc.viewport.split(/[;,]/).map((part) => {
        const [k, v] = part.split('=');
        return [k?.trim().toLowerCase() ?? '', v?.trim().toLowerCase() ?? ''];
      }),
    );

    // Pinch-to-zoom, switched off. WCAG 1.4.4 asks for text to reach 200%, and
    // a maximum-scale under 2 forbids exactly that. iOS has ignored the tag
    // since Safari 10, which is why the mistake survives: it is invisible to
    // whoever tested it on their own phone, and Android honours it.
    const maxScale = Number.parseFloat(viewport['maximum-scale']);
    const locked = ['no', '0'].includes(viewport['user-scalable']);
    if (locked || (Number.isFinite(maxScale) && maxScale < 2)) {
      out.push(f('warn', 'viewport-locked', 'Viewport blocks zooming',
        `"${doc.viewport}" — ${locked ? 'user-scalable is off' : `maximum-scale is ${maxScale}`}, so text ` +
          'cannot be enlarged to the 200% WCAG 1.4.4 asks for. Safari has ignored this since iOS 10, so it ' +
          'looks fine on an iPhone and blocks zoom everywhere else.', url));
    }

    // A pixel width is a desktop layout announced to a phone: the browser lays
    // the page out that wide and scales the result down. Google indexes what
    // the mobile crawler renders, and that is the shrunken version.
    const width = viewport.width;
    if (width && width !== 'device-width' && /^\d+$/.test(width)) {
      out.push(f('warn', 'viewport-fixed-width', 'Viewport declares a fixed width',
        `"${doc.viewport}" — width=${width} lays the page out ${width}px wide on every phone and scales ` +
          'it down to fit. width=device-width is what makes a responsive layout responsive.', url));
    }
  }

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

  // The type is declared and the JSON parses, and the rich result still never
  // appears because a property Google requires is not there.
  const shortfalls = [];
  for (const node of schemaNodes(doc.jsonld)) {
    for (const type of [node['@type']].flat().filter((t) => typeof t === 'string')) {
      const missing = (SCHEMA_REQUIRED[type] ?? []).filter((p) => !present(node[p]));
      if (type === 'Product') {
        if (!present(node.name)) missing.push('name');
        if (!PRODUCT_ONE_OF.some((p) => present(node[p]))) {
          missing.push(`one of ${PRODUCT_ONE_OF.join(', ')}`);
        }
      }
      if (missing.length) shortfalls.push(`${type} is missing ${missing.join(' and ')}`);
    }
  }
  if (shortfalls.length) {
    out.push(f('warn', 'schema-incomplete', 'Structured data is missing a property Google requires',
      `${[...new Set(shortfalls)].join('; ')}. The markup is valid and the type is right, so nothing ` +
        'reports an error — the rich result simply never appears.', url));
  }

  // --- Images -------------------------------------------------------------
  // role="presentation" (or "none") declares an image decorative in ARIA, which
  // is the same statement alt="" makes and is honoured by screen readers.
  // alt="" is still the more robust way to say it, but this is a deliberate
  // choice rather than an oversight — mozilla.org's accessibility team ships it
  // — and calling a deliberate choice an error is how a report gets ignored.
  const decorativeByRole = (i) => /^(presentation|none)$/i.test(i.role ?? '');
  const noAlt = doc.images.filter(
    (i) => i.alt === null && !decorativeByRole(i) && !i.altBound,
  );
  if (noAlt.length) {
    // An <img> can have no src either — a lazy-loading placeholder, or markup
    // waiting on JavaScript. Saying "First: null" helped nobody find it.
    const where = noAlt[0].src ?? 'an <img> with no src attribute either';
    out.push(f('error', 'img-alt', `${noAlt.length} image(s) with no alt attribute`,
      `First: ${where}. Decorative images need alt="" — the attribute must exist either way.`, url));
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

  // The `title` attribute is never reported for being absent — an image without
  // one has nothing wrong with it, it is a hover tooltip that touch devices
  // cannot show and Google does not read. What is worth saying is when it
  // contradicts something else on the same tag.
  const titledSameAsAlt = doc.images.filter(
    (i) => i.title && i.alt && i.title.trim() === i.alt.trim(),
  );
  if (titledSameAsAlt.length) {
    out.push(f('info', 'img-title-duplicates-alt', `${titledSameAsAlt.length} image(s) repeat the alt text as a title`,
      `First: "${titledSameAsAlt[0].title}" on ${titledSameAsAlt[0].src}. One field filling both is the usual ` +
        'cause. It adds nothing for a sighted visitor and a screen reader that surfaces both reads it twice.', url));
  }

  const titledDecorative = doc.images.filter(
    (i) => i.title && (i.alt === '' || decorativeByRole(i)),
  );
  if (titledDecorative.length) {
    out.push(f('info', 'img-title-on-decorative', `${titledDecorative.length} decorative image(s) carry a title`,
      `First: "${titledDecorative[0].title}" on ${titledDecorative[0].src}. The markup declares the image ` +
        'decorative and then attaches a tooltip to it — one of the two is wrong.', url));
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
  // A nofollow on an internal link is a page telling Google not to walk its own
  // site. Sometimes deliberate — a login or a faceted filter nobody wants
  // crawled — so a note, not a complaint.
  const nofollowed = doc.links.nofollowInternal ?? [];
  if (nofollowed.length) {
    out.push(f('info', 'internal-nofollow', `${nofollowed.length} internal link(s) marked nofollow`,
      `First: ${nofollowed.slice(0, 3).join(', ')}. Fair for a login or a filter nobody should crawl; ` +
        'on an ordinary page it withholds a path through your own site for no gain.', url));
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
  // Only things the page *loads*. A browser blocks an http:// script and warns
  // about an http:// image; it does nothing whatever about <a href="http://…">,
  // which is an ordinary link to somebody else's site — usually one the author
  // does not control and cannot upgrade. Matching every href reported four
  // errors across five real sites, all of them outbound links and a feed.
  if (url.startsWith('https://')) {
    const insecure = [];
    // Same reason as in parseHtml: a code sample stored in an attribute is not
    // a resource this page loads.
    for (const match of stripMarkupInAttributes(page.html ?? '').matchAll(/<([a-z0-9-]+)\b[^>]*>/gi)) {
      const [tag, name] = [match[0], match[1].toLowerCase()];
      let loaded = null;
      if (SUBRESOURCE.test(name)) loaded = attr(tag, 'src');
      // A stylesheet is the one <link> fetched to render the page. rel=alternate
      // on a feed, and rel=canonical, are not fetched at all.
      else if (name === 'link' && /\bstylesheet\b/i.test(attr(tag, 'rel') ?? '')) {
        loaded = attr(tag, 'href');
      }
      if (loaded?.startsWith('http://') && !loaded.startsWith('http://localhost')) {
        insecure.push(loaded);
      }
    }
    if (insecure.length) {
      out.push(f('error', 'mixed-content', 'Insecure resources on an HTTPS page',
        `${insecure.length}, first: ${insecure[0]}. Browsers block or refuse to render these.`, url));
    }
  }

  // Not an estimate, which is the line this tool does not cross: whether the
  // response arrived compressed is a header, and how much HTML came back is a
  // byte count. Neither is a guess about how the page renders.
  //
  // Only for documents worth compressing — a CDN skipping a 900-byte response
  // is doing the right thing, and reporting it would be noise.
  const bytes = (page.html ?? '').length;
  if (!res.headers?.get?.('content-encoding') && bytes > COMPRESSIBLE_FROM) {
    out.push(f('warn', 'uncompressed', 'HTML is served without compression',
      `${(bytes / 1024).toFixed(0)}KB of HTML and no content-encoding. Gzip or Brotli typically takes ` +
        'markup to a quarter of this, and it is a server setting rather than a change to the page.', url));
  }
  if (bytes > HUGE_HTML) {
    out.push(f('info', 'huge-html', 'Very large HTML document',
      `${(bytes / 1024 / 1024).toFixed(1)}MB before any images or scripts. Not a limit — Google reads far ` +
        'more than this — but a document this size is usually a template inlining something it should link to.',
      url));
  }

  if (res.ms > LIMITS.slowMs) {
    out.push(f('info', 'slow', 'Slow response',
      `${res.ms}ms to first byte from this machine. Measure properly with WebPageTest.`, url));
  }

  return out;
}

// Elements whose src the browser fetches as part of rendering the page. These
// are what "mixed content" means; a hyperlink is not one of them.
const SUBRESOURCE = /^(img|script|iframe|video|audio|source|embed|track|input|object)$/;

const DAY = 24 * 60 * 60 * 1000;

// Below this, "every page shares a date" is a coincidence rather than a
// pattern — a five-page brochure site genuinely does get rebuilt all at once.
const LASTMOD_SAMPLE = 5;

/** Checks on the sitemap itself, rather than the pages it lists.
 *
 *  `now` is injectable so the tests are not hostage to the clock. */
// The protocol's hard limits, per file. Past either, a crawler is entitled to
// reject the whole sitemap rather than read part of it.
const SITEMAP_MAX_URLS = 50_000;
const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;

export function sitemapChecks(entries, source, now = Date.now(), files = []) {
  const out = [];

  for (const file of files) {
    if (file.urls > SITEMAP_MAX_URLS) {
      out.push(f('error', 'sitemap-too-many-urls', `A sitemap file lists ${file.urls.toLocaleString()} URLs`,
        `${file.url} — the protocol allows ${SITEMAP_MAX_URLS.toLocaleString()} per file, and past that a ` +
          'crawler may reject the whole file rather than read part of it. Split it and list the parts in a ' +
          'sitemap index.', file.url));
    }
    if (file.bytes > SITEMAP_MAX_BYTES) {
      out.push(f('error', 'sitemap-too-large', `A sitemap file is ${(file.bytes / 1024 / 1024).toFixed(1)}MB`,
        `${file.url} — the protocol allows 50MB uncompressed per file. Split it, or serve it gzipped.`,
        file.url));
    }
  }

  if (!entries.length) return out;

  const dated = entries.filter((entry) => entry.lastmod);
  if (!dated.length) {
    out.push(f('info', 'sitemap-lastmod-missing', 'No page in the sitemap declares a lastmod',
      'Crawlers use it to decide what to look at again. Without it, a large site is re-crawled on ' +
        'guesswork, and a page that changed waits its turn behind pages that did not.', source));
    return out;
  }

  // A day of slack, because a build stamping "now" on a machine with a skewed
  // clock is not the problem being described here.
  const future = dated.filter((entry) => {
    const at = Date.parse(entry.lastmod);
    return Number.isFinite(at) && at > now + DAY;
  });
  if (future.length) {
    out.push(f('warn', 'sitemap-lastmod-future', `${future.length} page(s) claim a lastmod in the future`,
      `First: ${future[0].loc} says ${future[0].lastmod}. A date that has not happened yet is not a ` +
        'signal a crawler can use, and it is usually a timezone or a scheduling bug in the generator.', source));
  }

  // The interesting failure: a generator stamping build time on every URL. It
  // looks diligent and is worth nothing, because Google learns the dates never
  // distinguish one page from another and stops reading them.
  const distinct = new Set(dated.map((entry) => entry.lastmod));
  if (dated.length >= LASTMOD_SAMPLE && distinct.size === 1) {
    out.push(f('info', 'sitemap-lastmod-identical', 'Every page in the sitemap has the same lastmod',
      `All ${dated.length} say ${dated[0].lastmod}. That is a generator stamping build time rather than ` +
        'when each page last changed — which tells a crawler nothing, so it learns to ignore the field.', source));
  }

  return out;
}

/** Checks that need every page at once. */
export function crossPageChecks(pages, opts = {}) {
  const LIMITS = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
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

  // --- Click depth --------------------------------------------------------
  // How many links from the homepage a page actually is. An orphan is the
  // extreme of this — nothing links to it at all — and it was the only part of
  // the shape being reported. A page five clicks down has the same illness
  // milder: Google finds it late, crawls it rarely, and passes it almost
  // nothing, while every single-page grader calls it perfect.
  //
  // The graph is the one already built above, so this costs no requests.
  //
  // The root is the homepage, and a sitemap is under no obligation to list it:
  // eslint.org's names 499 URLs and not the one every visitor starts from. The
  // caller may hand one over for exactly that case; it is a root to measure
  // from, never a page to report on.
  const key = (u) => withoutSlash((u ?? '').split('#')[0]);
  const home =
    live.find((p) => new URL(p.url).pathname.replace(/\/$/, '') === '') ??
    (opts.home?.doc ? opts.home : null);
  if (home) {
    const crawled = new Map(live.map((p) => [key(p.url), p]));
    if (!crawled.has(key(home.url))) crawled.set(key(home.url), home);
    const depth = new Map([[key(home.url), 0]]);
    const cameFrom = new Map();
    // Breadth first, so the first time a page is reached is by its shortest
    // path — which is the number being reported, and the route worth printing.
    for (let frontier = [key(home.url)]; frontier.length; ) {
      const next = [];
      for (const at of frontier) {
        for (const href of crawled.get(at)?.doc.links.internal ?? []) {
          const to = key(href);
          if (!crawled.has(to) || depth.has(to)) continue;
          depth.set(to, depth.get(at) + 1);
          cameFrom.set(to, at);
          next.push(to);
        }
      }
      frontier = next;
    }

    // Pages with no path from home at all. A few are a finding. A lot means the
    // navigation is built by JavaScript and this tool cannot see it — and then
    // every depth here is wrong, so none of them is worth printing. Google
    // renders, so it can follow those links; the honest report is that the
    // question was not answered, not a page of invented findings.
    const stranded = live.filter((p) => !depth.has(key(p.url)));
    const unreadable = live.length >= 5 && stranded.length > live.length * 0.3;

    if (opts.truncated > 0 || unreadable) {
      out.push(f('info', 'click-depth-skipped', 'Click depth was not measured',
        opts.truncated > 0
          ? `The crawl stopped ${opts.truncated} page(s) short of the whole site, so the links between ` +
            'the pages that were fetched are a fragment of the real graph. A distance measured across ' +
            'a fragment is not the distance, so it is not reported. Raise --limit to measure it.'
          : `${stranded.length} of ${live.length} crawled pages have no chain of links from the homepage ` +
            'reaching them, which is what a JavaScript-built navigation looks like to something that ' +
            'reads HTML. Google renders and can follow those links, so the depths here would be wrong ' +
            'rather than alarming, and are not reported.',
        home.url));
    } else {
      // Linked from somewhere, yet no route from the homepage — the page is
      // reachable only from another page that is itself unreachable. Orphans
      // are excluded: nothing links to those, which is already reported, and
      // saying it twice about one page helps nobody.
      for (const p of stranded) {
        if (!linkedTo.has(key(p.url))) continue;
        out.push(f('warn', 'no-path-from-home', 'No path from the homepage to this page',
          'Something links to it, but no chain of links starting at the homepage arrives — it hangs off ' +
            'a page that is itself unreachable. A crawler that has not been handed the sitemap never ' +
            'finds it, and it inherits nothing from the pages that rank.', p.url));
      }

      const routeTo = (k) => {
        const hops = [];
        for (let at = k; at !== undefined; at = cameFrom.get(at)) hops.unshift(new URL(at).pathname || '/');
        return hops.join(' → ');
      };
      const deep = live
        .filter((p) => depth.get(key(p.url)) > LIMITS.maxClickDepth)
        .sort((a, b) => depth.get(key(b.url)) - depth.get(key(a.url)));
      for (const p of deep.slice(0, 20)) {
        const clicks = depth.get(key(p.url));
        out.push(f('info', 'deep-page', `${clicks} clicks from the homepage`,
          `${routeTo(key(p.url))} — the shortest route in. Anything worth ranking is usually worth ` +
            `reaching in ${LIMITS.maxClickDepth}.`, p.url));
      }
      if (deep.length > 20) {
        out.push(f('info', 'deep-page-more', `${deep.length - 20} more pages are over ${LIMITS.maxClickDepth} clicks deep`,
          `${deep.length} of ${live.length} crawled pages sit deeper than ${LIMITS.maxClickDepth} clicks. ` +
            'The first 20 are listed above, deepest first.', home.url));
      }
    }
  }

  // --- Anchor text --------------------------------------------------------
  // The words attached to a link are the one description of a page that comes
  // from outside it, and the only signal on this list that a page cannot write
  // about itself. Two things can go wrong with them, and only one is a matter
  // of taste.
  const inbound = new Map();
  const named = new Set();
  const blank = new Map();
  for (const p of live) {
    for (const { href, name } of p.doc.links.anchorTexts ?? []) {
      // Keyed without the trailing slash, because a page can link to itself
      // both ways and mean the same page. wordpress.org/education names Campus
      // Connect three times at `/campus-connect/` and once, wordlessly, at
      // `/campus-connect` — matching the strings would have called a page with
      // three good links unreadable.
      const target = withoutSlash(href);
      if (!name) {
        blank.set(target, [...(blank.get(target) ?? []), p.url]);
        continue; // no words at all is the finding below, not a vocabulary problem
      }
      named.add(target);
      inbound.set(target, [...(inbound.get(target) ?? []), name]);
    }
  }
  // A destination is only unreadable if *nothing* names it. The card is the
  // reason: a thumbnail with an emptied alt and the headline beside it are two
  // links to one article, and elementor.com's blog index has twenty-three of
  // them. The headline says what the article is, so Google is not in the dark
  // and neither is anybody else — reporting that would be the noisiest kind of
  // wrong, a true observation with a false conclusion attached.
  const nameless = new Map([...blank].filter(([href]) => !named.has(href)));

  // A link with no text, no image alt, no aria-label and no title. Google is
  // told a page exists and nothing whatever about it; a screen reader reads the
  // URL aloud, one slash at a time. Usually an icon — a bare <i class="…">, or
  // a thumbnail whose alt was emptied because the headline beside it is a
  // second link to the same place.
  //
  // Grouped by destination rather than reported per page, because the ones that
  // exist are nearly always in a header or a footer, and the same social icon
  // on two hundred pages is one thing to fix.
  const namelessTargets = [...nameless].sort((a, b) => b[1].length - a[1].length);
  for (const [href, pages] of namelessTargets.slice(0, 10)) {
    out.push(f('warn', 'link-no-text', 'Link with nothing to read',
      `${href} is linked with no text, no image alt, no aria-label and no title, from ` +
        `${pages.length} page(s): ${pages.slice(0, 3).join(', ')}. Google is told the page exists and ` +
        'nothing about it, and a screen reader announces the URL instead of a description.',
      pages[0]));
  }
  if (namelessTargets.length > 10) {
    out.push(f('info', 'link-no-text-more', `${namelessTargets.length - 10} more destinations are linked with no text`,
      `${namelessTargets.length} in all. The ten linked from the most pages are listed above.`,
      namelessTargets[0][1][0]));
  }

  // A page every one of whose inbound links says "read more". Each of those
  // links on its own is ordinary — a card under a headline has to say
  // something — and reporting them one at a time would fire on every blog
  // index ever built. What is worth knowing is the page that has nothing else:
  // no link anywhere on the site tells Google what it is about.
  const generic = live.filter((p) => {
    const names = inbound.get(withoutSlash(p.url));
    return names?.length && names.every((n) => GENERIC_ANCHORS.has(anchorPhrase(n)));
  });
  for (const p of generic.slice(0, 10)) {
    const names = inbound.get(withoutSlash(p.url));
    const shown = [...new Set(names.map((n) => `"${n}"`))].slice(0, 3).join(', ');
    out.push(f('info', 'anchor-generic', 'Every link to this page says the same empty thing',
      `${names.length} link(s) point here and all of them read ${shown}. Anchor text is the one ` +
        'description of a page that comes from somewhere other than the page itself, and this one has ' +
        'none — the words say what to do, not what is there.', p.url));
  }
  if (generic.length > 10) {
    out.push(f('info', 'anchor-generic-more', `${generic.length - 10} more pages are linked only by generic anchors`,
      `${generic.length} of ${live.length} crawled pages have no inbound link that describes them.`,
      generic[0].url));
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
