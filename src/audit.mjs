// Orchestration: find the pages, fetch them, run the checks.
import { Fetcher, mapLimit } from './http.mjs';
import { parseHtml, parseSitemap } from './parse.mjs';
import { pageChecks, crossPageChecks } from './checks.mjs';
import { siteChecks } from './site.mjs';

/** Sitemap URLs, following a sitemap index one level down.
 *
 *  robots.txt is asked first, because that is where a site *declares* its
 *  sitemap and guessing filenames only works for the conventions you thought
 *  of — Yoast writes `/sitemap_index.xml`, Astro writes `/sitemap-index.xml`,
 *  and both are wrong to assume. */
async function discover(origin, fetcher, explicit) {
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
    if (!res.ok || !/<(urlset|sitemapindex)/i.test(res.body)) continue;

    const { urls, sitemaps } = parseSitemap(res.body);
    if (urls.length) return { urls, source: candidate };

    const nested = await mapLimit(sitemaps, 4, async (child) => {
      const sub = (await fetcher.chain(child)).final;
      return sub.ok ? parseSitemap(sub.body).urls : [];
    });
    const all = nested.flat();
    if (all.length) return { urls: all, source: candidate };
  }
  return { urls: [], source: null };
}

/**
 * @param {string} target site origin, or a sitemap URL
 * @param {{limit?: number, concurrency?: number, sitemap?: string}} opts
 */
export async function audit(target, opts = {}) {
  const started = Date.now();
  const fetcher = new Fetcher({ concurrency: opts.concurrency ?? 6 });

  const url = new URL(target);
  const origin = url.origin;
  const { urls, source } = await discover(origin, fetcher, opts.sitemap ?? (/\.xml$/i.test(url.pathname) ? target : null));

  const findings = [];

  if (!urls.length) {
    findings.push({
      level: 'error',
      id: 'no-sitemap',
      title: 'No sitemap found',
      detail:
        'Tried /sitemap-index.xml and /sitemap.xml. Without one, crawlers discover pages by ' +
        'following links only — and this tool has nothing to audit. Pass --sitemap <url> if it lives elsewhere.',
      url: origin,
    });
    return { findings, meta: { origin, pages: 0, requests: fetcher.count, ms: Date.now() - started } };
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

  for (const page of pages) findings.push(...pageChecks(page));
  findings.push(...crossPageChecks(pages));
  findings.push(...(await siteChecks(origin, fetcher, pages, opts)));

  if (truncated > 0) {
    findings.push({
      level: 'info',
      id: 'truncated',
      title: `${truncated} pages were not checked`,
      detail: `The sitemap lists ${urls.length} URLs and the limit is ${list.length}. Raise it with --limit.`,
      url: source,
    });
  }

  return {
    findings,
    meta: {
      origin,
      pages: pages.length,
      requests: fetcher.count,
      ms: Date.now() - started,
      date: new Date().toISOString().slice(0, 10),
      sitemap: source,
    },
  };
}
