// Orchestration: find the pages, fetch them, run the checks.
import { Fetcher, mapLimit } from './http.mjs';
import { parseHtml, parseSitemap } from './parse.mjs';
import { parseRobots, robotsVerdict } from './robots.mjs';
import { redirectChecks } from './redirects.mjs';
import { pageChecks, crossPageChecks, sitemapChecks } from './checks.mjs';
import { siteChecks } from './site.mjs';
import { linkGraph } from './graph.mjs';
import { compareAgents } from './compare.mjs';
import { searchConsole } from './console.mjs';
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
  // A 429 is the server saying "ask later", which is not the same as "there is
  // no sitemap here". Reporting absence from a refusal to answer is a false
  // positive, and the caller needs to know the difference.
  let rateLimited = false;
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
    if (res.status === 429) rateLimited = true;
    if (!res.ok || !/<(urlset|sitemapindex)/i.test(res.body)) continue;

    const { urls, sitemaps, entries } = parseSitemap(res.body);
    // Per-file, because the 50,000-URL and 50MB limits are per sitemap file
    // rather than per site — a flattened total would report the wrong thing.
    // `locs` as well as the count, because a URL listed in two files of one
    // index cannot be seen from a flattened total.
    const stat = (url, body, locs) => ({ url, urls: locs.length, bytes: Buffer.byteLength(body), locs });

    if (urls.length) {
      return {
        urls,
        entries,
        files: [stat(candidate, res.body, urls)],
        source: candidate,
        tried,
        rateLimited,
      };
    }

    const nested = await mapLimit(sitemaps, 4, async (child) => {
      const sub = (await fetcher.chain(child)).final;
      if (!sub.ok) return { urls: [], entries: [], files: [] };
      const parsed = parseSitemap(sub.body);
      return { ...parsed, files: [stat(child, sub.body, parsed.urls)] };
    });
    const all = nested.flatMap((n) => n.urls);
    if (all.length) {
      return {
        urls: all,
        entries: nested.flatMap((n) => n.entries),
        files: nested.flatMap((n) => n.files),
        source: candidate,
        tried,
        rateLimited,
      };
    }
  }
  return { urls: [], entries: [], files: [], source: null, tried, rateLimited };
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
async function crawlByLinks(origin, fetcher, { limit, concurrency, robotsGroups, onProgress }) {
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
      onProgress?.({ phase: 'crawl', status: final.status, ms: final.ms, url: final.url });
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
  const findings = [];

  // Which host actually serves the site. Everything once-per-domain —
  // robots.txt, llms.txt, the security headers — is only meaningful on the
  // host that answers, and a crawler reads them there: RFC 9309 asks for at
  // least five redirects to be followed for robots.txt, and Google follows
  // them.
  //
  // Audited from the bare domain of a site that lives at www, this used to
  // read all three off a 301. A store with a good robots.txt — agent
  // instructions, a UCP endpoint, the lot — was reported as having none, its
  // llms.txt was looked for on a host that does not serve it, and its
  // Referrer-Policy verdict came from a redirect's headers. Three findings,
  // none of them true, on any site that lives at www.
  let origin = url.origin;
  const landing = await fetcher.chain(`${url.origin}/`);
  if (landing.final.ok) {
    const settled = new URL(landing.final.url).origin;
    if (settled !== origin) {
      findings.push({
        level: 'info',
        id: 'origin-redirected',
        title: 'Audited the host this one redirects to',
        detail:
          `${origin}/ answers ${landing.hops[0]?.status ?? 301} and the chain ends at ${settled}/, so ` +
          'that is where the pages, robots.txt, llms.txt and the response headers were read. Reading ' +
          'them off the redirect instead is how a site with a perfectly good robots.txt gets reported ' +
          'as having none.',
        url: origin,
      });
      opts.onNote?.(`${origin} redirects to ${settled} — auditing there`);
      origin = settled;
    }
  }

  // Give a rolling deploy time to reach every edge before judging it.
  if (opts.settle) {
    const settled = await fetcher.settle(origin + '/', opts.settle);
    if (!settled && opts.onNote) {
      opts.onNote(`still serving inconsistent HTML after ${opts.settle}s — crawling anyway`);
    }
  }
  const { urls, entries, files, source, tried, rateLimited: sitemapRateLimited } = await discover(
    origin,
    fetcher,
    opts.sitemap ?? (/\.xml$/i.test(url.pathname) ? target : null),
  );

  const limit = opts.limit ?? 200;
  const concurrency = opts.concurrency ?? 6;
  const onProgress = opts.onProgress;

  if (source) onProgress?.({ phase: 'sitemap', url: source, detail: `${urls.length} URLs` });

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
      onProgress?.({ phase: 'crawl', status: res.status, ms: res.ms, url: pageUrl });
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

    const crawled = await crawlByLinks(origin, fetcher, {
      limit,
      concurrency,
      robotsGroups,
      onProgress,
    });
    pages = crawled.pages;
    truncated = crawled.remaining;

    // A refusal to answer is not an absence. If the server rate-limited the
    // probe, this run learned nothing about whether a sitemap exists, and
    // saying "No sitemap found" would be a finding about the crawl reported as
    // a finding about the site.
    findings.push(
      sitemapRateLimited
        ? {
            level: 'warn',
            id: 'sitemap-not-checked',
            title: 'Whether there is a sitemap is not known',
            detail:
              `Tried: ${tried.join(', ')}. The server answered HTTP 429 — "ask later" — so this run ` +
              'never saw whether a sitemap is there, and followed links from the homepage instead, ' +
              `reaching ${pages.length} page(s). This is a fact about the crawl, not about the site. ` +
              'Run it again with a lower --concurrency, or pass --sitemap <url>.',
            url: origin,
          }
        : {
            level: 'warn',
            id: 'no-sitemap',
            title: 'No sitemap found',
            detail:
              `Tried: ${tried.join(', ')}. This run followed links from the homepage instead, which is what a ` +
              `crawler has to do without one — ${pages.length} pages were reached that way. A sitemap states ` +
              'the pages you want indexed rather than leaving it to be inferred, and carries lastmod. ' +
              'Pass --sitemap <url> if one exists somewhere unusual.',
            url: origin,
          },
    );

    if (!pages.some((p) => p.res.ok)) {
      findings.push(
        sitemapRateLimited || fetcher.rateLimited > 0
          ? {
              level: 'error',
              id: 'crawl-rate-limited',
              title: 'Nothing was read — the server rate limited this run',
              detail:
                'Every request came back HTTP 429, so no page was read and nothing below is a ' +
                'statement about the site. Wait, then run it again with a lower --concurrency. ' +
                'Two runs back to back against the same host will do this on their own.',
              url: origin,
            }
          : {
              level: 'error',
              id: 'nothing-crawlable',
              title: 'Nothing could be crawled',
              detail:
                'No sitemap, and the homepage did not return a page to follow links from. There is nothing ' +
                'here to audit.',
              url: origin,
            },
      );
    }
  }

  onProgress?.({ phase: 'crawl', detail: `${pages.length} pages in ${((Date.now() - started) / 1000).toFixed(1)}s` });

  for (const page of pages) findings.push(...pageChecks(page, opts.limits));
  // Click depth is measured from the homepage, and a sitemap need not list it.
  // Fetched here only when the crawl did not already have it, and the fetcher
  // caches, so the site checks below pay nothing for it.
  let home = null;
  if (!pages.some((p) => p.doc && p.res.ok && new URL(p.url).pathname.replace(/\/$/, '') === '')) {
    const { final } = await fetcher.chain(origin);
    if (final.ok && /text\/html/i.test(final.headers.get('content-type') ?? '')) {
      home = { url: final.url, doc: parseHtml(final.body, final.url) };
    }
  }
  // One graph for the whole run: the orphan check and click depth read it, and
  // so does the ordering of the report. How many links point at a page, and how
  // far it is from the homepage, is the difference between a list of problems
  // and a list of work worth doing.
  const graph = linkGraph(pages.filter((p) => p.doc && p.res.ok), home);
  findings.push(...crossPageChecks(pages, { limits: opts.limits, truncated, home, graph }));
  // The same pages, asked for by somebody else. Only when asked for: it doubles
  // the request cost of every page it looks at.
  if (opts.compareAs) {
    findings.push(
      ...(await compareAgents(pages, {
        agent: opts.compareAs.ua,
        label: opts.compareAs.label,
        sample: opts.compareSample ?? 10,
        onProgress,
      })),
    );
  }
  findings.push(...sitemapChecks(entries, source, Date.now(), files));
  findings.push(...expectationChecks(pages, opts.expect));
  onProgress?.({ phase: 'checks', detail: `${findings.length} findings from the pages themselves` });
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
        onProgress,
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
      findings.push(...(await psiChecks(targets, { strategy: opts.psiStrategy, onProgress })));
    }
  }

  // Said once, at the end, because a run that took eight minutes should say
  // why. It is not a finding about the site: it is this tool describing what it
  // had to do to get through, and it is the only place the numbers above can be
  // read as "slower than usual" rather than "something is wrong".
  if (fetcher.rateLimited > 0) {
    findings.push({
      level: 'info',
      id: 'rate-limit-slowed',
      title: 'The crawl was slowed down to get through',
      detail:
        `The server answered HTTP 429 — asking for a slower crawl — ${fetcher.rateLimited} time(s), so ` +
        `requests were paused and the concurrency came down to ${fetcher.concurrency}. This is not a ` +
        'finding about the site — it explains the elapsed time, and any page reported as rate-limited ' +
        'was not read at all. Pass a lower --concurrency to get through cleanly.',
      url: origin,
    });
  }

  // What these pages actually do in Google. Opt-in, and the only thing here
  // that needs an account.
  if (opts.searchConsole) {
    findings.push(...(await searchConsole(origin, findings, {
      siteUrl: typeof opts.searchConsole === 'string' ? opts.searchConsole : undefined,
    })));
  }

  if (truncated > 0) {
    findings.push({
      level: 'info',
      id: 'truncated',
      title: bySitemap
        ? `${truncated} pages were not checked`
        : `At least ${truncated} more pages are linked but were not checked`,
      detail: bySitemap
        ? `The sitemap lists ${urls.length} URLs and the limit is ${pages.length}. Run it again with ` +
          `--limit ${urls.length} to check them all.`
        : `The crawl stopped at ${pages.length} pages with more still queued. Following links cannot know ` +
          'the total in advance the way a sitemap can, so this is a floor, not a count. Raise it with --limit.',
      url: source ?? origin,
    });
  }

  // Where a finding sits matters nearly as much as what it is. A thin page
  // Google will index is a problem; the same page carrying noindex, or handing
  // its ranking to a canonical elsewhere, is one nobody needs to act on. Tagged
  // in a single pass at the end rather than threaded through every check, since
  // it is a property of the page rather than of any one thing found on it.
  const notIndexable = new Set();
  for (const page of pages) {
    // A page the server refused to hand over is not a page that refuses to be
    // indexed. Its indexability is unknown, and "not indexable" is an answer.
    if (page.res.status === 429) continue;
    if (!page.res.ok) {
      notIndexable.add(page.url);
      continue;
    }
    if (!page.doc) continue;
    const header = page.res.headers?.get?.('x-robots-tag') ?? '';
    const noindexed = /noindex/i.test(page.doc.robots ?? '') || /noindex/i.test(header);
    const canonical = page.doc.canonical?.[0];
    const defersElsewhere =
      canonical && canonical.replace(/\/$/, '') !== page.url.replace(/\/$/, '');
    if (noindexed || defersElsewhere) notIndexable.add(page.url);
  }
  for (const finding of findings) {
    if (finding.url && notIndexable.has(finding.url)) finding.indexable = false;
    // Absent stays absent: "nothing links here" and "this was never measured"
    // are different answers, and only one of them is about the site.
    const reach = finding.url ? graph.reachOf(finding.url) : null;
    if (reach) finding.reach = reach;
  }

  // The sitemap says "index this"; the page says otherwise. Same shape as
  // robots.txt disallowing a sitemap URL, and just as invisible: each file is
  // defensible alone and they only contradict each other when read together.
  //
  // Pages that failed to load are excluded — page-status and sitemap-redirect
  // already report those, and this would say it a second time in worse words.
  if (bySitemap) {
    const listed = new Set(urls.map((u) => u.replace(/\/$/, '')));
    const contradictions = pages.filter(
      (p) => p.res.ok && p.doc && notIndexable.has(p.url) && listed.has(p.url.replace(/\/$/, '')),
    );
    if (contradictions.length) {
      const why = (p) =>
        /noindex/i.test(p.doc.robots ?? '') || /noindex/i.test(p.res.headers?.get?.('x-robots-tag') ?? '')
          ? 'noindex'
          : `canonical → ${p.doc.canonical[0]}`;
      findings.push({
        level: 'warn',
        id: 'sitemap-not-indexable',
        title: `${contradictions.length} sitemap URL(s) will not be indexed`,
        detail:
          `${contradictions.slice(0, 3).map((p) => `${p.url} (${why(p)})`).join(', ')}` +
          `${contradictions.length > 3 ? `, and ${contradictions.length - 3} more` : ''}. A sitemap is a ` +
          'list of the pages you want indexed; these ask not to be. Either drop them from the sitemap or ' +
          'drop the directive.',
        url: source,
      });
    }
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
      notIndexable: notIndexable.size,
      requests: fetcher.count,
      ms: Date.now() - started,
      date: new Date().toISOString().slice(0, 10),
      sitemap: source,
    },
  };
}
