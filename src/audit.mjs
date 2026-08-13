// Orchestration: find the pages, fetch them, run the checks.
import { Fetcher, mapLimit } from './http.mjs';
import { parseHtml, parseSitemap } from './parse.mjs';
import { parseRobots, robotsVerdict } from './robots.mjs';
import { redirectChecks } from './redirects.mjs';
import { pageChecks, crossPageChecks, sitemapChecks } from './checks.mjs';
import { siteChecks } from './site.mjs';
import { applyIgnores, expectationChecks } from './config.mjs';
import { psiChecks, psiTargets, estimateSeconds } from './psi.mjs';

/** Sitemap URLs, following a sitemap index one level down.
 *
 *  robots.txt is asked first, because that is where a site *declares* its
 *  sitemap and guessing filenames only works for the conventions you thought
 *  of — Yoast writes `/sitemap_index.xml`, Astro writes `/sitemap-index.xml`,
 *  and both are wrong to assume. */
async function discover(origin, fetcher, explicit) {
  const tried = [];
  let candidates = [explicit];

  if (!explicit) {
    const robots = await fetcher.get(new URL('/robots.txt', origin).toString());
    const declared = robots.ok
      ? [...robots.body.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1])
      : [];
    candidates = [
      ...declared,
      new URL('/sitemap-index.xml', origin).toString(),
      new URL('/sitemap_index.xml', origin).toString(),
      new URL('/sitemap.xml', origin).toString(),
    ];
  }

  for (const candidate of candidates) {
    // A sitemap may itself redirect (http→https, or /sitemap.xml → the index).
    const res = (await fetcher.chain(candidate)).final;
    tried.push(`${candidate} → ${res.error ?? res.status}`);
    if (!res.ok || !/<(urlset|sitemapindex)/i.test(res.body)) continue;

    const { urls, sitemaps, entries } = parseSitemap(res.body);
    if (urls.length) return { urls, entries, source: candidate, tried };

    const nested = await mapLimit(sitemaps, 4, async (child) => {
      const sub = (await fetcher.chain(child)).final;
      return sub.ok ? parseSitemap(sub.body) : { urls: [], entries: [] };
    });
    const all = nested.flatMap((n) => n.urls);
    if (all.length) {
      return { urls: all, entries: nested.flatMap((n) => n.entries), source: candidate, tried };
    }
  }
  return { urls: [], entries: [], source: null, tried };
}

// Files that are linked from pages but are not pages. Fetching a 40MB video to
// discover it has no <title> wastes the crawl budget on a site that, by
// definition, has no sitemap telling us where the pages actually are.
const NOT_A_PAGE =
  /\.(jpe?g|png|gif|webp|avif|svg|ico|pdf|zip|gz|mp4|webm|mp3|wav|woff2?|ttf|eot|css|js|json|xml|txt|csv|docx?|xlsx?)($|\?)/i;

/**
 * Breadth-first from the homepage, following internal links.
 *
 * Only used when no sitemap exists. Ordinarily that stopped the tool dead,
 * which meant the sites least likely to have been looked after were the ones it
 * refused to look at.
 *
 * robots.txt is obeyed. A crawler that ignores it is rude, and here it would
 * also spend the budget on exactly the pages nobody wants indexed.
 */
async function crawlByLinks(origin, fetcher, { limit, concurrency, robotsGroups }) {
  const start = new URL('/', origin).toString();
  const queued = new Set([start]);
  const visited = new Set();
  let frontier = [start];
  const pages = [];

  while (frontier.length && pages.length < limit) {
    const batch = frontier.slice(0, limit - pages.length);
    frontier = [];

    // Redirects are followed here, unlike everywhere else in this tool. A link
    // crawl has to land on the page a visitor would land on: www.mozilla.org/
    // answers 302 to /en-US/, and reading only the first hop finds a redirect
    // with no links in it and concludes the site has one page.
    const fetched = await mapLimit(batch, concurrency, async (pageUrl) => {
      const { final } = await fetcher.chain(pageUrl);
      const isHtml = /text\/html/i.test(final.headers.get('content-type') ?? '');
      return {
        url: final.url,
        res: final,
        html: final.body,
        doc: final.ok && isHtml ? parseHtml(final.body, final.url) : null,
      };
    });

    for (const page of fetched) {
      // Two aliases redirecting to one page are one page.
      const key = page.url.replace(/\/$/, '');
      if (visited.has(key)) continue;
      // A redirect that leaves the site is somebody else's page.
      if (!page.url.startsWith(origin)) continue;
      visited.add(key);
      pages.push(page);

      for (const href of page.doc?.links.internal ?? []) {
        const clean = href.split('#')[0];
        if (queued.has(clean) || visited.has(clean.replace(/\/$/, '')) || NOT_A_PAGE.test(clean)) continue;
        try {
          if (!robotsVerdict(robotsGroups, new URL(clean).pathname).allowed) continue;
        } catch {
          continue;
        }
        queued.add(clean);
        frontier.push(clean);
      }
    }
  }

  // Everything reachable that the budget did not reach.
  return { pages, remaining: frontier.length };
}

/**
 * @param {string} target site origin, or a sitemap URL
 * @param {{limit?: number, concurrency?: number, sitemap?: string}} opts
 */
export async function audit(target, opts = {}) {
  const started = Date.now();
  const fetcher = new Fetcher({ concurrency: opts.concurrency ?? 6, userAgent: opts.userAgent });

  const url = new URL(target);
  const origin = url.origin;

  // Give a rolling deploy time to reach every edge before judging it.
  if (opts.settle) {
    const settled = await fetcher.settle(origin + '/', opts.settle);
    if (!settled && opts.onNote) {
      opts.onNote(`still serving inconsistent HTML after ${opts.settle}s — crawling anyway`);
    }
  }
  const { urls, entries, source, tried } = await discover(
    origin,
    fetcher,
    opts.sitemap ?? (/\.xml$/i.test(url.pathname) ? target : null),
  );

  const findings = [];
  const limit = opts.limit ?? 200;
  const concurrency = opts.concurrency ?? 6;

  // A host that never answered is not a sitemap problem, and following links
  // from a page that does not load would find nothing either.
  if (!urls.length && !fetcher.reachable) {
    findings.push({
      level: 'error',
      id: 'unreachable',
      title: 'The site did not answer a single request',
      detail:
        `Tried: ${tried.join(', ')}. The TLS connection succeeds but no response arrives, which ` +
        'usually means a bot-protection rule is stalling non-browser clients — Cloudflare Bot ' +
        "Fight Mode does exactly this. If it is your site, allow this crawler's user agent, or " +
        'pass --user-agent to present a different one.',
      url: origin,
    });
    return {
      findings,
      meta: {
        origin,
        pages: 0,
        ignored: 0,
        requests: fetcher.count,
        ms: Date.now() - started,
        date: new Date().toISOString().slice(0, 10),
      },
    };
  }

  let pages;
  let truncated = 0;
  const bySitemap = urls.length > 0;

  if (bySitemap) {
    const list = urls.slice(0, limit);
    truncated = urls.length - list.length;
    pages = await mapLimit(list, concurrency, async (pageUrl) => {
      const res = await fetcher.get(pageUrl);
      const isHtml = /text\/html/i.test(res.headers.get('content-type') ?? '');
      return {
        url: pageUrl,
        res,
        html: res.body,
        doc: res.ok && isHtml ? parseHtml(res.body, pageUrl) : null,
      };
    });
  } else {
    // No sitemap, but the site answers. Follow links instead of giving up: the
    // sites least likely to have been looked after were the ones this refused
    // to look at.
    opts.onNote?.('no sitemap — following links from the homepage instead');
    const robotsRes = await fetcher.get(new URL('/robots.txt', origin).toString());
    const robotsGroups = robotsRes.ok ? parseRobots(robotsRes.body) : [];

    const crawled = await crawlByLinks(origin, fetcher, { limit, concurrency, robotsGroups });
    pages = crawled.pages;
    truncated = crawled.remaining;

    findings.push({
      level: 'warn',
      id: 'no-sitemap',
      title: 'No sitemap found',
      detail:
        `Tried: ${tried.join(', ')}. This run followed links from the homepage instead, which is what a ` +
        `crawler has to do without one — ${pages.length} pages were reached that way. A sitemap states ` +
        'the pages you want indexed rather than leaving it to be inferred, and carries lastmod. ' +
        'Pass --sitemap <url> if one exists somewhere unusual.',
      url: origin,
    });

    if (!pages.some((p) => p.res.ok)) {
      findings.push({
        level: 'error',
        id: 'nothing-crawlable',
        title: 'Nothing could be crawled',
        detail:
          'No sitemap, and the homepage did not return a page to follow links from. There is nothing ' +
          'here to audit.',
        url: origin,
      });
    }
  }

  for (const page of pages) findings.push(...pageChecks(page, opts.limits));
  findings.push(...crossPageChecks(pages));
  findings.push(...sitemapChecks(entries, source));
  findings.push(...expectationChecks(pages, opts.expect));
  findings.push(
    ...(await siteChecks(origin, fetcher, pages, { ...opts, sitemapUrls: urls, bySitemap })),
  );

  // A migration's redirect map, checked against the live site. Only when one
  // is handed over: there is nothing to infer here, and guessing at old URLs
  // would invent findings.
  if (opts.redirectRules?.length) {
    findings.push(
      ...(await redirectChecks(opts.redirectRules, fetcher, origin, {
        limit: opts.maxRedirectChecks ?? 200,
      })),
    );
  }

  // Performance, measured by Google rather than guessed at here. Slow and
  // rate-limited, so only on request, and for a named page or a sample of a
  // named section rather than the whole crawl.
  if (opts.psi?.length) {
    const { urls: targets, notes } = psiTargets(opts.psi, pages.map((p) => p.url), {
      origin,
      sample: opts.psiSample,
    });
    findings.push(...notes);
    if (targets.length) {
      opts.onNote?.(
        `measuring ${targets.length} page(s) with PageSpeed Insights — about ` +
          `${Math.ceil(estimateSeconds(targets.length) / 60)} min …`,
      );
      findings.push(...(await psiChecks(targets, { strategy: opts.psiStrategy })));
    }
  }

  if (truncated > 0) {
    findings.push({
      level: 'info',
      id: 'truncated',
      title: bySitemap
        ? `${truncated} pages were not checked`
        : `At least ${truncated} more pages are linked but were not checked`,
      detail: bySitemap
        ? `The sitemap lists ${urls.length} URLs and the limit is ${pages.length}. Raise it with --limit.`
        : `The crawl stopped at ${pages.length} pages with more still queued. Following links cannot know ` +
          'the total in advance the way a sitemap can, so this is a floor, not a count. Raise it with --limit.',
      url: source ?? origin,
    });
  }

  // What the site has decided to live with is dropped last, so an ignore rule
  // can silence a site-wide check as easily as a per-page one.
  const [kept, ignored] = applyIgnores(findings, opts.ignore);

  return {
    findings: kept,
    meta: {
      ignored,
      origin,
      pages: pages.length,
      requests: fetcher.count,
      ms: Date.now() - started,
      date: new Date().toISOString().slice(0, 10),
      sitemap: source,
    },
  };
}
