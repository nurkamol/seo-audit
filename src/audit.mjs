// Orchestration: find the pages, fetch them, run the checks.
import { Fetcher, mapLimit } from './http.mjs';
import { parseHtml, parseSitemap } from './parse.mjs';
import { pageChecks, crossPageChecks } from './checks.mjs';
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

    const { urls, sitemaps } = parseSitemap(res.body);
    if (urls.length) return { urls, source: candidate, tried };

    const nested = await mapLimit(sitemaps, 4, async (child) => {
      const sub = (await fetcher.chain(child)).final;
      return sub.ok ? parseSitemap(sub.body).urls : [];
    });
    const all = nested.flat();
    if (all.length) return { urls: all, source: candidate, tried };
  }
  return { urls: [], source: null, tried };
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
  const { urls, source, tried } = await discover(
    origin,
    fetcher,
    opts.sitemap ?? (/\.xml$/i.test(url.pathname) ? target : null),
  );

  const findings = [];

  if (!urls.length) {
    findings.push(
      fetcher.reachable
        ? {
            level: 'error',
            id: 'no-sitemap',
            title: 'No sitemap found',
            detail:
              `Tried: ${tried.join(', ')}. Without a sitemap, crawlers discover pages by following ` +
              'links only, and this tool has nothing to audit. Pass --sitemap <url> if it lives elsewhere.',
            url: origin,
          }
        : {
            level: 'error',
            id: 'unreachable',
            title: 'The site did not answer a single request',
            detail:
              `Tried: ${tried.join(', ')}. The TLS connection succeeds but no response arrives, which ` +
              'usually means a bot-protection rule is stalling non-browser clients — Cloudflare Bot ' +
              "Fight Mode does exactly this. If it is your site, allow this crawler's user agent, or " +
              'pass --user-agent to present a different one.',
            url: origin,
          },
    );
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

  const list = urls.slice(0, opts.limit ?? 200);
  const truncated = urls.length - list.length;

  const pages = await mapLimit(list, opts.concurrency ?? 6, async (pageUrl) => {
    const res = await fetcher.get(pageUrl);
    const isHtml = /text\/html/i.test(res.headers.get('content-type') ?? '');
    return {
      url: pageUrl,
      res,
      html: res.body,
      doc: res.ok && isHtml ? parseHtml(res.body, pageUrl) : null,
    };
  });

  for (const page of pages) findings.push(...pageChecks(page, opts.limits));
  findings.push(...crossPageChecks(pages));
  findings.push(...expectationChecks(pages, opts.expect));
  findings.push(...(await siteChecks(origin, fetcher, pages, { ...opts, sitemapUrls: urls })));

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
      title: `${truncated} pages were not checked`,
      detail: `The sitemap lists ${urls.length} URLs and the limit is ${list.length}. Raise it with --limit.`,
      url: source,
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
