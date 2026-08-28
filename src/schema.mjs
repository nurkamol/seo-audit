// The structured data this site could add, built only from what it already says.
//
// Every schema generator on the internet asks you to type the answers in. This
// one refuses to ask, because the moment it asks it is no longer describing
// the site — and structured data that describes a site inaccurately is worse
// than none: it is a claim to Google, in a machine-readable format, that the
// page does not support. Google calls that spammy structured data and it is a
// manual-action category.
//
// So the rule here is narrower than the rest of this project's and it is
// absolute: **every value emitted is a string this crawl actually read off this
// site.** No slug is title-cased into a name, no page type is inferred from a
// URL shape, no date is guessed. Where the evidence runs out, the page is
// skipped and counted, and `describeSchema()` says how many and why.
//
// That leaves three things, which is fewer than a paid tool offers and all of
// which are true:
//
//   * `WebSite`  — the home page's own title, URL and description.
//   * `Organization` — only when the site names itself in `og:site_name`.
//     Without it the name would be a guess, and a wrong organisation name is
//     the single worst thing in this file to get wrong.
//   * `BreadcrumbList` — from pages the crawl read. `/docs/configuration/x`
//     becomes a trail only if `/docs/` and `/docs/configuration/` were both
//     fetched, because then every step has the title its own page gave it.
//     One missing ancestor and the page is skipped rather than given a
//     prettified slug.

import { GENERIC_ANCHORS, anchorPhrase } from './checks.mjs';

const SCHEMA = 'https://schema.org';

/** What the site itself calls a page, for a breadcrumb step.
 *
 *  A `<title>` is not a breadcrumb name. jekyllrb.com's /docs/assets/ is titled
 *  "Assets | Jekyll • Simple, blog-aware, static sites", and a trail built from
 *  titles renders the whole site name at every step — which is what the first
 *  live run of this produced, and why the order below exists:
 *
 *   1. The page's `<h1>`, when it has exactly one. That is the page naming
 *      itself, on itself, and it is the best evidence there is. Two h1s and it
 *      is not clear which is the page's name, which is a fault this tool
 *      already reports.
 *   2. What the rest of the site calls it — the anchor text its own navigation
 *      uses, when the links agree and the words are not "read more". A
 *      breadcrumb *is* the site naming a page, so this is not second best so
 *      much as the same evidence from another direction.
 *   3. Nothing, and the page is skipped. A trail with a step named from a slug
 *      tells Google a name the site does not use. */
function nameOf(page, anchors) {
  if (page.doc.h1?.length === 1 && page.doc.h1[0]) return page.doc.h1[0];

  const said = anchors.get(trimSlash(page.url));
  if (!said?.size) return null;
  const [best] = [...said].sort((a, b) => b[1] - a[1]);
  const [text, times] = best;
  if (GENERIC_ANCHORS.has(anchorPhrase(text))) return null;
  // One link saying it is a link; several saying the same thing is a name.
  return times >= 2 || said.size === 1 ? text : null;
}

/** Every internal link's words, counted per destination. The site's own name
 *  for each of its pages, as often as it uses it. */
function anchorNames(pages) {
  const byUrl = new Map();
  for (const page of pages) {
    for (const anchor of page.doc?.links?.anchorTexts ?? []) {
      if (!anchor.href || !anchor.name?.trim()) continue;
      const key = trimSlash(anchor.href);
      const counts = byUrl.get(key) ?? new Map();
      const name = anchor.name.trim();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      byUrl.set(key, counts);
    }
  }
  return byUrl;
}

/** Whether a page already declares a type, so nothing is generated twice.
 *
 *  Read out of the JSON-LD the crawl parsed, `@graph` included — a site whose
 *  breadcrumbs live inside a graph node has breadcrumbs. */
function declares(doc, type) {
  const seen = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node['@type'] === 'string') seen.push(node['@type']);
    if (Array.isArray(node['@type'])) seen.push(...node['@type'].filter((t) => typeof t === 'string'));
    if (node['@graph']) walk(node['@graph']);
  };
  for (const block of doc.jsonld ?? []) if (block.ok) walk(block.data);
  return seen.includes(type);
}

const trimSlash = (url) => url.replace(/\/$/, '');

/** Every page the crawl read that is worth describing, by its path.
 *
 *  Indexable and its own canonical, the same rule the sitemap and llms.txt
 *  apply: a page Google will not keep is not one to write structured data for. */
function usablePages(pages) {
  const byPath = new Map();
  for (const page of pages) {
    if (!page.res?.ok || !page.doc || !page.doc.title) continue;
    if (/noindex/i.test(page.doc.robots ?? '')) continue;
    const canonical = page.doc.canonical?.[0];
    if (canonical && trimSlash(canonical) !== trimSlash(page.url)) continue;
    try {
      byPath.set(trimSlash(new URL(page.url).pathname) || '/', page);
    } catch {
      /* not a URL this can place in a trail */
    }
  }
  return byPath;
}

/** The trail to a page, or null when any step of it was not crawled.
 *
 *  Null rather than a partial trail: a BreadcrumbList that skips a level tells
 *  Google a hierarchy that does not exist, and a trail whose names came from
 *  slugs tells it names the site does not use. */
function trail(page, byPath, anchors) {
  let path;
  try {
    path = new URL(page.url).pathname;
  } catch {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  // The home page and its direct children sit at the top of the site: there is
  // no trail to describe, which is not the same as one that could not be built.
  if (segments.length < 2) return 'top-level';

  const home = byPath.get('/');
  if (!home) return null;

  // The home page is the one step whose name is not the page's own: "Jekyll"
  // is its h1, but a trail starting at the site's h1 rather than at "Home" is
  // still the site's own word for itself, so the same rule applies.
  const homeName = nameOf(home, anchors);
  if (!homeName) return null;

  const steps = [{ name: homeName, url: home.url }];
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const at = `/${segments.slice(0, depth).join('/')}`;
    const found = byPath.get(at);
    // An ancestor that was never fetched cannot be named honestly.
    if (!found) return null;
    const name = nameOf(found, anchors);
    if (!name) return null;
    steps.push({ name, url: found.url });
  }
  return steps;
}

/**
 * @param pages    what the crawl read: `[{ url, res, doc }]`
 * @param context  `{ origin, truncated, rateLimited }`
 */
export function buildSchema(pages, context = {}) {
  const { origin = '', truncated = 0, rateLimited = 0 } = context;

  if (truncated > 0) {
    return refuse(
      `The crawl stopped at its limit with ${truncated} URL(s) unread. A breadcrumb trail is only ` +
        'honest when every step of it was fetched, so this would silently describe fewer pages than ' +
        `it looks like. Run again with --limit ${pages.length + truncated}.`,
    );
  }
  if (rateLimited > 0) {
    return refuse(
      `${rateLimited} page(s) were never read because the server was rate limiting, so the trails ` +
        'through them cannot be built. Run again with a lower --concurrency.',
    );
  }

  const byPath = usablePages(pages);
  const anchors = anchorNames(pages);
  const home = byPath.get('/');
  const generated = [];
  const skipped = {};
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  // --- The site, and whoever runs it --------------------------------------
  if (home) {
    if (!declares(home.doc, 'WebSite')) {
      generated.push({
        url: home.url,
        jsonld: {
          '@context': SCHEMA,
          '@type': 'WebSite',
          name: home.doc.title,
          url: home.url,
          ...(home.doc.description ? { description: home.doc.description } : {}),
        },
      });
    } else {
      skip('already-has-website');
    }

    // Only when the site names itself. `og:site_name` is the one place a site
    // states what it is called as an organisation rather than as a page, and
    // without it the name would be the home page's title with the tagline
    // still attached — which is a claim about a company's name.
    const siteName = home.doc.og?.['og:site_name'];
    if (!siteName) {
      skip('no-og-site-name');
    } else if (declares(home.doc, 'Organization')) {
      skip('already-has-organization');
    } else {
      const logo = home.doc.icons?.[0] ?? home.doc.og?.['og:image'];
      generated.push({
        url: home.url,
        jsonld: {
          '@context': SCHEMA,
          '@type': 'Organization',
          name: siteName,
          url: origin || home.url,
          // Declared by the site itself, never picked. Absent when it declares
          // neither an icon nor an og:image.
          ...(logo ? { logo } : {}),
        },
      });
    }
  }

  // --- Where each page sits ----------------------------------------------
  for (const page of byPath.values()) {
    if (declares(page.doc, 'BreadcrumbList')) {
      skip('already-has-breadcrumbs');
      continue;
    }
    const steps = trail(page, byPath, anchors);
    if (steps === 'top-level') {
      skip('top-level');
      continue;
    }
    if (!steps) {
      skip('no-complete-trail');
      continue;
    }
    generated.push({
      url: page.url,
      jsonld: {
        '@context': SCHEMA,
        '@type': 'BreadcrumbList',
        itemListElement: steps.map((step, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: step.name,
          item: step.url,
        })),
      },
    });
  }

  if (!generated.length) {
    // The counts travel with the refusal. A site that already declares
    // everything and a site that gave nothing to build from are two different
    // answers, and throwing the reasons away made them read the same — which
    // is the failure this project refuses everywhere else.
    // Three different answers, and they must not read the same. A page that
    // already declares its markup, and a page at the top of the site that
    // needs none, are both fine; a page whose trail could not be named is the
    // only one that is a gap.
    const nothingWrong = Object.entries(skipped)
      .filter(([reason]) => !reason.startsWith('already-') && reason !== 'top-level')
      .reduce((n, [, count]) => n + count, 0);
    return refuse(
      nothingWrong
        ? 'Nothing could be written from what this site already says. Every value here has to be a ' +
          'string the crawl read off the site, and this one either declares the markup already or ' +
          'gives no evidence to build it from.'
        : 'This site already declares everything that could be written for it, which is the good ' +
          'version of this answer.',
      skipped,
    );
  }

  return {
    json: `${JSON.stringify({ generated, skipped }, null, 2)}\n`,
    generated,
    skipped,
    refused: null,
  };
}

function refuse(why, skipped = {}) {
  return { json: null, generated: [], skipped, refused: why };
}

const REASONS = {
  'already-has-website': 'already declares a WebSite',
  'already-has-organization': 'already declares an Organization',
  'already-has-breadcrumbs': 'already declares a BreadcrumbList',
  'no-og-site-name': 'no og:site_name, so the organisation name would be a guess',
  'no-complete-trail': 'a step could not be named from the site\'s own words',
  'top-level': 'is at the top of the site, so there is no trail to describe',
};

/** The summary line for a terminal, and for the note the CLI prints. */
export function describeSchema(result, path) {
  if (result.refused) {
    const why = Object.entries(result.skipped)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `    ${String(count).padEnd(4)} ${REASONS[reason] ?? reason}`);
    return [`  Did not write ${path}: ${result.refused}`, ...why].join('\n') + '\n';
  }
  const types = {};
  for (const entry of result.generated) {
    types[entry.jsonld['@type']] = (types[entry.jsonld['@type']] ?? 0) + 1;
  }
  const out = [`  wrote ${path} — ${result.generated.length} block(s) for ${new Set(result.generated.map((e) => e.url)).size} page(s)`];
  for (const [type, count] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
    out.push(`    ${String(count).padEnd(4)} ${type}`);
  }
  for (const [reason, count] of Object.entries(result.skipped).sort((a, b) => b[1] - a[1])) {
    out.push(`    skipped ${String(count).padEnd(3)} (${REASONS[reason] ?? reason})`);
  }
  return out.join('\n') + '\n';
}
