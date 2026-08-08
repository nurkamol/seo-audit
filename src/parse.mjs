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

/** Attribute value from a tag string: attr(`<img alt="x">`, 'alt') → 'x' */
export function attr(tag, name) {
  const m =
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) ??
    tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  if (m) return decode(m[1]);
  // Bare boolean attribute (`<img alt>`) — present, empty value.
  return new RegExp(`\\b${name}(?=[\\s/>])`, 'i').test(tag) ? '' : null;
}

export function parseHtml(html, pageUrl) {
  const head = (html.match(/<head[\s\S]*?<\/head>/i) ?? [''])[0];
  const main = (html.match(/<main[\s\S]*?<\/main>/i) ?? [''])[0] || html;

  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const metaBy = (key, value) => {
    const tag = metas.find((t) => (attr(t, key) ?? '').toLowerCase() === value);
    return tag ? attr(tag, 'content') : null;
  };

  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const linkRel = (rel) => links.filter((t) => (attr(t, 'rel') ?? '').toLowerCase() === rel);

  const abs = (href) => {
    try {
      return new URL(href, pageUrl).toString();
    } catch {
      return null;
    }
  };

  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
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

  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => {
    const tag = m[0];
    return {
      tag,
      src: attr(tag, 'src'),
      alt: attr(tag, 'alt'),
      width: attr(tag, 'width'),
      height: attr(tag, 'height'),
      srcset: attr(tag, 'srcset'),
      loading: attr(tag, 'loading'),
      // Inside a <picture> the sibling <source> may carry the srcset instead.
      inPicture: false,
    };
  });

  const pictures = [...html.matchAll(/<picture[\s\S]*?<\/picture>/gi)].map((m) => m[0]);
  for (const img of images) {
    if (img.src && pictures.some((p) => p.includes(img.src))) img.inPicture = true;
  }

  const headings = (level) =>
    [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, 'gi'))].map((m) =>
      stripTags(m[1]),
    );

  const bodyText = stripTags(
    main
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' '),
  );

  return {
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [null, null])[1]?.trim(),
    description: metaBy('name', 'description'),
    robots: metaBy('name', 'robots'),
    viewport: metaBy('name', 'viewport'),
    lang: attr((html.match(/<html\b[^>]*>/i) ?? [''])[0], 'lang'),
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

/** URLs from a sitemap or sitemap index. Returns {urls, sitemaps}. */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}
