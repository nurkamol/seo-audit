// Minimal HTML extraction.
//
// No parser dependency on purpose: this tool should run anywhere with `npx`
// and nothing installed. The regexes below are deliberately narrow — they read
// well-formed markup produced by a static site generator, which is what this
// audits. Anything ambiguous is reported as unknown rather than guessed.

const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

/** Attribute value from a tag string: attr(`<img alt="x">`, 'alt') → 'x'
 *
 *  The lookbehind matters, and has been widened twice by real sites:
 *
 *  - `\b` treats the hyphen in `data-src` as a boundary, so a plain
 *    word-boundary match reads a lazy-loading site's `data-src` as its `src`
 *    and reports images that are not there.
 *  - `:` and `[` introduce a framework binding — `:src`, `v-bind:src`,
 *    `x-bind:src`, `[src]` — whose value is a JavaScript expression, not a URL.
 *    allbirds.com binds `:src="(cardRefs['7205190238288']?.selectedImage…)"`,
 *    and reading those as real sources reported twenty-four of its images as
 *    404s that do not exist. */
export function attr(tag, name) {
  const start = `(?<![-:\\[\\w])${name}`;
  const m =
    tag.match(new RegExp(`${start}\\s*=\\s*"([^"]*)"`, 'i')) ??
    tag.match(new RegExp(`${start}\\s*=\\s*'([^']*)'`, 'i')) ??
    // Unquoted, which HTML permits and minifiers produce: smashingmagazine.com
    // ships `<meta name=viewport content="…">`, and reading only quoted values
    // reported nine of its pages as having no viewport at all.
    tag.match(new RegExp(`${start}\\s*=\\s*([^\\s"'\`=<>]+)`, 'i'));
  if (m) return decode(m[1]);
  // Bare boolean attribute (`<img alt>`) — present, with an empty value.
  return new RegExp(`${start}(?=[\\s/>])`, 'i').test(tag) ? '' : null;
}

/** Blank out attribute values that contain whole tags.
 *
 *  Markup inside an attribute value is a code sample, not part of the page.
 *  astro.build stores an entire Astro component in a `data-code` attribute for
 *  its copy button, and the `<img src={product.imageUrl}>` in that string was
 *  read as a real image with no alt — an error, on a site that has no such
 *  problem.
 *
 *  Deliberately narrow: the value must contain something shaped like a tag, so
 *  `title="a < b"` and `content="Tea & Cake"` are untouched. */
export const stripMarkupInAttributes = (html) =>
  html.replace(/="[^"]*<[a-z][^">]*>[^"]*"/gi, '=""');

export function parseHtml(rawHtml, pageUrl) {
  const html = stripMarkupInAttributes(rawHtml);

  // Elements are read from markup with <script> and <style> contents removed.
  // A script that builds HTML by concatenation — `'<li><a href="' + a.url + '">'`
  // — is code, not links on the page, and smashingmagazine.com's offline-article
  // list had nine of those reported as links to a page that does not exist.
  //
  // JSON-LD is read from `html` instead, because it lives inside a <script>.
  const markup = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const head = (markup.match(/<head[\s\S]*?<\/head>/i) ?? [''])[0];
  const main = (markup.match(/<main[\s\S]*?<\/main>/i) ?? [''])[0] || markup;

  const metas = [...markup.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const metaBy = (key, value) => {
    const tag = metas.find((t) => (attr(t, key) ?? '').toLowerCase() === value);
    return tag ? attr(tag, 'content') : null;
  };

  const links = [...markup.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const linkRel = (rel) => links.filter((t) => (attr(t, 'rel') ?? '').toLowerCase() === rel);

  const abs = (href) => {
    try {
      return new URL(href, pageUrl).toString();
    } catch {
      return null;
    }
  };

  const anchors = [...markup.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
  const mainAnchors = [...main.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
  const hrefs = (list) =>
    list
      .map((t) => attr(t, 'href'))
      .filter((h) => h && !/^(#|mailto:|tel:|javascript:|data:)/i.test(h))
      .map(abs)
      .filter(Boolean);

  const origin = new URL(pageUrl).origin;
  const internal = (list) => hrefs(list).filter((h) => h.startsWith(origin));

  const jsonld = [...html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => {
      try {
        return { ok: true, data: JSON.parse(m[1]) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

  const images = [...markup.matchAll(/<img\b[^>]*>/gi)].map((m) => {
    const tag = m[0];
    return {
      tag,
      src: attr(tag, 'src'),
      alt: attr(tag, 'alt'),
      width: attr(tag, 'width'),
      height: attr(tag, 'height'),
      srcset: attr(tag, 'srcset'),
      loading: attr(tag, 'loading'),
      role: attr(tag, 'role'),
      // `:alt="item.title"` is alt text the framework fills in on render. The
      // value cannot be read from here, but the author plainly provided one,
      // and calling that a missing alt is guessing wrong at error level.
      altBound: /[:[]alt\b/i.test(tag),
      // Inside a <picture> the sibling <source> may carry the srcset instead.
      inPicture: false,
    };
  });

  const pictures = [...markup.matchAll(/<picture[\s\S]*?<\/picture>/gi)].map((m) => m[0]);
  for (const img of images) {
    if (img.src && pictures.some((p) => p.includes(img.src))) img.inPicture = true;
  }

  const headings = (level) =>
    [...markup.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, 'gi'))].map((m) =>
      stripTags(m[1]),
    );

  // Heading levels in document order, so a skipped level is visible — read
  // from <main> only. The footer's column headings are furniture repeated on
  // every page, not part of this page's outline, and counting them reports a
  // jump on exactly the pages whose content happens to have no h2.
  const headingLevels = [...main.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));

  const bodyText = stripTags(
    main
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' '),
  );

  return {
    title: (markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [null, null])[1]?.trim(),
    description: metaBy('name', 'description'),
    robots: metaBy('name', 'robots'),
    viewport: metaBy('name', 'viewport'),
    lang: attr((markup.match(/<html\b[^>]*>/i) ?? [''])[0], 'lang'),
    canonical: linkRel('canonical').map((t) => abs(attr(t, 'href'))).filter(Boolean),
    hreflang: linkRel('alternate')
      .filter((t) => attr(t, 'hreflang'))
      .map((t) => ({ lang: attr(t, 'hreflang'), href: abs(attr(t, 'href')) })),
    og: Object.fromEntries(
      metas
        .filter((t) => (attr(t, 'property') ?? '').startsWith('og:'))
        .map((t) => [attr(t, 'property'), attr(t, 'content')]),
    ),
    twitter: Object.fromEntries(
      metas
        .filter((t) => (attr(t, 'name') ?? '').startsWith('twitter:'))
        .map((t) => [attr(t, 'name'), attr(t, 'content')]),
    ),
    h1: headings(1),
    h2: headings(2),
    headingLevels,
    charset:
      metaBy('charset', undefined) ??
      (metas.some((t) => attr(t, 'charset') !== null)
        ? attr(metas.find((t) => attr(t, 'charset') !== null), 'charset')
        : /charset=/i.test(head)
          ? 'declared'
          : null),
    images,
    jsonld,
    links: {
      internal: [...new Set(internal(anchors))],
      inMain: [...new Set(internal(mainAnchors))],
      external: [...new Set(hrefs(anchors).filter((h) => !h.startsWith(origin)))],
    },
    words: bodyText ? bodyText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0,
  };
}

/** URLs from a sitemap or sitemap index. Returns {urls, sitemaps, entries}.
 *
 *  `entries` pairs each <loc> with its own <lastmod>, read from inside the
 *  <url> block so a date cannot drift onto a neighbouring URL. It is additional
 *  rather than a replacement: `urls` stays a plain list of strings, because
 *  every caller wants exactly that and changing it would ripple through
 *  discovery for no gain. */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  const isIndex = /<sitemapindex/i.test(xml);
  if (isIndex) return { urls: [], sitemaps: locs, entries: [] };

  const entries = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)]
    .map((m) => ({
      loc: decode(m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1] ?? ''),
      lastmod: m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1] ?? null,
    }))
    .filter((entry) => entry.loc);

  return { urls: locs, sitemaps: [], entries };
}
