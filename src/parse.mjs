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
    .replace(/&nbsp;/g, ' ')
    // The typographic entities a CMS emits into link text and headings. Left
    // undecoded, "here's their page &raquo;" normalises to a phrase with the
    // word "raquo" in it, which is nobody's anchor text.
    .replace(/&(l|r)aquo;/g, (_, side) => (side === 'l' ? '«' : '»'))
    .replace(/&(m|n)dash;/g, (_, kind) => (kind === 'm' ? '—' : '–'))
    .replace(/&hellip;/g, '…')
    .replace(/&(l|r)squo;/g, "'")
    .replace(/&(l|r)dquo;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

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

// Japanese, Chinese and Thai do not put spaces between words, so splitting on
// whitespace counts an entire paragraph as one. The Japanese translation of a
// React docs page counted 177 against the English original's 411 — the same
// page, the same content — and was reported as thin.
//
// Counted at roughly two characters to the word, the usual working equivalence.
// It is an approximation, and deliberately a generous one: over-counting keeps
// a real page quiet, while under-counting calls it thin, and only one of those
// is a finding somebody has to argue with.
const UNSPACED_SCRIPT =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-๿]/g;

export function countWords(text) {
  if (!text) return 0;
  const unspaced = text.match(UNSPACED_SCRIPT)?.length ?? 0;
  const spaced = text
    .replace(UNSPACED_SCRIPT, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return spaced + Math.round(unspaced / 2);
}

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

  // The three rel values Google reads a favicon from, and `rel` is a token
  // list, so the legacy `shortcut icon` is matched by the `icon` in it without
  // needing a rule of its own.
  const ICON_RELS = new Set(['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed']);

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

  // Anchors paired with the words attached to them. Google reads those words as
  // a description of the destination — they are the one signal a page gets from
  // outside itself — and until now they were parsed and thrown away.
  //
  // The name is resolved the way a browser resolves an accessible name, in
  // order, because each of these is a real way to label a link and reporting
  // any of them as unlabelled would be wrong:
  //
  //   the text inside → an image's alt → aria-label → the anchor's own title
  //
  // aria-labelledby points at another element by id. It is not followed here —
  // that means reading the rest of the document — and its mere presence counts
  // as named, since the alternative is calling a labelled link unlabelled.
  //
  // A missing </a> makes the match run to the next one, which produces text
  // where there was none. That direction is safe: it can only silence this,
  // never invent it.
  const namedAnchors = [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => {
    const tag = `<a${m[1]}>`;
    const inner = m[2];
    const img = inner.match(/<img\b[^>]*>/i)?.[0];
    const svgTitle = inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const name =
      decode(stripTags(inner)) ||
      (img && attr(img, 'alt')) ||
      attr(tag, 'aria-label') ||
      attr(tag, 'title') ||
      (svgTitle && decode(stripTags(svgTitle))) ||
      (img && attr(img, 'title')) ||
      // A framework binding is a label the author supplied and this cannot
      // read — `:alt="item.title"`, `[ariaLabel]="…"`. The same trap that made
      // img-alt report twenty-four of allbirds.com's images as missing alt.
      (img && /[:[]alt\b/i.test(img) ? '…' : '') ||
      (/[:[](attr\.)?aria-?label\b/i.test(tag) ? '…' : '') ||
      // Labelled by something elsewhere in the document, or by a child that
      // labels itself. Not resolved, only believed.
      (attr(tag, 'aria-labelledby') !== null || /aria-label(ledby)?=/i.test(inner) ? '…' : '') ||
      '';
    return { tag, href: attr(tag, 'href'), name: name.slice(0, 300) };
  });

  // Internal only, self-links dropped: a page linking to itself says nothing
  // about anywhere, and a logo in the header does it on every page of the site.
  const anchorTexts = namedAnchors
    .filter((a) => a.href && !/^(#|mailto:|tel:|javascript:|data:)/i.test(a.href))
    .map((a) => ({ ...a, href: abs(a.href) }))
    .filter((a) => a.href?.startsWith(origin))
    .map((a) => ({ href: a.href.split('#')[0], name: a.name }))
    .filter((a) => a.href.replace(/\/$/, '') !== pageUrl.split('#')[0].replace(/\/$/, ''));

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
      fetchpriority: attr(tag, 'fetchpriority'),
      role: attr(tag, 'role'),
      // Captured for the two things it can contradict, never for its absence:
      // an image with no title has nothing wrong with it.
      title: attr(tag, 'title'),
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
    // <meta http-equiv="refresh" content="0;url=…"> — a redirect that is not
    // one, and the only kind this tool can see in the markup.
    refresh: metaBy('http-equiv', 'refresh'),
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
    // Declared favicons, in the order a search engine would prefer them: the
    // plain `icon` first, then the iOS ones. Google looks for these on the
    // home page and draws the result beside every listing the site owns.
    icons: links
      .map((tag) => ({
        rel: (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean),
        href: abs(attr(tag, 'href')),
      }))
      .filter((icon) => icon.href && icon.rel.some((r) => ICON_RELS.has(r)))
      .sort((a, b) => Number(b.rel.includes('icon')) - Number(a.rel.includes('icon')))
      .map((icon) => icon.href)
      .filter((href, i, all) => all.indexOf(href) === i),
    jsonld,
    links: {
      internal: [...new Set(internal(anchors))],
      inMain: [...new Set(internal(mainAnchors))],
      external: [...new Set(hrefs(anchors).filter((h) => !h.startsWith(origin)))],
      // Internal links the page tells Google not to follow. `rel` carries a
      // space-separated list, so nofollow travels with noopener and friends.
      //
      // Fragments are stripped and self-links dropped: WordPress marks its
      // comment-reply links rel="nofollow" pointing at #respond on the page
      // they are already on, and every article on a WordPress site would report
      // a withheld path that leads nowhere new.
      // Every internal link with the words attached to it — see above.
      anchorTexts,
      nofollowInternal: [
        ...new Set(
          internal(anchors.filter((t) => /(^|\s)nofollow(\s|$)/i.test(attr(t, 'rel') ?? '')))
            .map((h) => h.split('#')[0])
            .filter((h) => h.replace(/\/$/, '') !== pageUrl.split('#')[0].replace(/\/$/, '')),
        ),
      ],
    },
    words: countWords(bodyText),
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
