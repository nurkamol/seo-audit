// The site's internal link graph, built once and read by everything that needs
// it: the orphan check, click depth, and the ordering of the report.
//
// It was computed inside crossPageChecks and thrown away, which meant the two
// checks that used it could disagree with each other and nothing else could use
// it at all. A finding's *reach* — how many links point at the pages it affects,
// and how far those pages are from the homepage — is the difference between a
// list of problems and a list of work worth doing, and it was already in memory.

/** How a URL is compared with another. Fragments are not pages and a trailing
 *  slash is not a difference. */
export const key = (url) => (url ?? '').split('#')[0].replace(/\/$/, '');

const isHome = (url) => {
  try {
    return new URL(url).pathname.replace(/\/$/, '') === '';
  } catch {
    return false;
  }
};

/** Build the graph from crawled pages.
 *
 *  `home` is the page to measure distance from, and may be one the crawl never
 *  fetched — a sitemap is under no obligation to list it. Returns:
 *
 *    depth    key → clicks from the homepage, absent when nothing reaches it
 *    inlinks  key → how many pages link to it, self-links not counted
 *    from     key → the page it was first reached through, for printing a route
 *    stranded pages with no path from the homepage at all
 *
 *  Everything here is a count of links that were actually read. Nothing is
 *  weighted, scored, or guessed. */
export function linkGraph(live, home = null) {
  const pages = new Map(live.map((p) => [key(p.url), p]));
  const root = live.find((p) => isHome(p.url)) ?? (home?.doc ? home : null);
  if (root && !pages.has(key(root.url))) pages.set(key(root.url), root);

  const inlinks = new Map();
  for (const page of pages.values()) {
    const seen = new Set();
    for (const href of page.doc?.links?.internal ?? []) {
      const target = key(href);
      // A page linking to itself says nothing about how well linked it is, and
      // a logo in the header does it on every page of the site.
      if (target === key(page.url) || seen.has(target)) continue;
      seen.add(target);
      inlinks.set(target, (inlinks.get(target) ?? 0) + 1);
    }
  }

  const depth = new Map();
  const from = new Map();
  if (root) {
    depth.set(key(root.url), 0);
    // Breadth first, so the first time a page is reached is by its shortest
    // path — which is the number worth reporting and the route worth printing.
    for (let frontier = [key(root.url)]; frontier.length; ) {
      const next = [];
      for (const at of frontier) {
        for (const href of pages.get(at)?.doc?.links?.internal ?? []) {
          const to = key(href);
          if (!pages.has(to) || depth.has(to)) continue;
          depth.set(to, depth.get(at) + 1);
          from.set(to, at);
          next.push(to);
        }
      }
      frontier = next;
    }
  }

  return {
    root,
    depth,
    from,
    inlinks,
    stranded: live.filter((p) => !depth.has(key(p.url))),
    /** What a finding on this URL can reach: how many pages link to it, and how
     *  far it is from the homepage. Absent values stay absent rather than
     *  becoming zero, because "nothing links here" and "this was never
     *  measured" are different answers. */
    reachOf(url) {
      const at = key(url);
      if (!pages.has(at)) return null;
      return { inlinks: inlinks.get(at) ?? 0, depth: depth.get(at) ?? null };
    },
  };
}
