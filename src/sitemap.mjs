// The sitemap this site should have had.
//
// Every other output here describes a problem. This one is the fix: the crawl
// already knows every URL it read, what each answered, whether it says
// noindex, and where its canonical points, which is exactly what decides
// whether a URL belongs in a sitemap.
//
// The refusals below matter more than the file. A sitemap that quietly drops
// real pages is worse than one full of dead ones — the dead ones are a warning
// in Search Console, and the missing ones are pages that stop being crawled.
// So this refuses to write anything from a run that did not see the whole site,
// and says which run would.

/** The five characters XML cannot carry raw. `&` first, or the others get
 *  their own ampersands escaped a second time. */
const escape = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const same = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '');

/** Why a URL the crawl saw is not in the file. Each is a decision somebody
 *  could disagree with, so each is counted and named rather than summarised. */
const REASONS = {
  status: 'did not answer 200',
  'not-html': 'is not an HTML page',
  noindex: 'says noindex',
  'canonical-elsewhere': 'has a canonical pointing at another page',
  'robots-disallowed': 'is disallowed by robots.txt',
};

/**
 * @param pages     what the crawl read: `[{ url, res, doc }]`
 * @param findings  the run's findings, read for pages that are linked but were
 *                  missing from the sitemap — those are confirmed 200 HTML by
 *                  the link sweep, and belong in the file
 * @param context   `{ entries, truncated, rateLimited, allowed }`
 */
export function rebuild(pages, findings = [], context = {}) {
  const { entries = [], truncated = 0, rateLimited = 0, allowed = () => true } = context;

  // --- when not to write anything ----------------------------------------
  if (truncated > 0) {
    return refuse(
      `The crawl stopped at its limit with ${truncated} URL(s) unread, so this file would leave ` +
        `them out of the sitemap entirely. Run again with --limit ${pages.length + truncated}.`,
    );
  }
  if (rateLimited > 0) {
    return refuse(
      `${rateLimited} page(s) were never read because the server was rate limiting, so whether they ` +
        'belong in a sitemap is not known. Run again with a lower --concurrency.',
    );
  }
  // More linked-but-missing pages than the report enumerates. It says how many
  // there are but not which, and a file built without them is incomplete.
  if (findings.some((f) => f.id === 'missing-from-sitemap-more')) {
    return refuse(
      'More pages are linked but missing from the sitemap than the report lists individually, so ' +
        'this file could not include all of them. Raise the link sweep cap and run again.',
    );
  }

  // --- what goes in -------------------------------------------------------
  const lastmod = new Map(entries.filter((e) => e.lastmod).map((e) => [e.loc, e.lastmod]));
  const excluded = {};
  const drop = (reason) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  };

  const keep = [];
  for (const page of pages) {
    if (!page.res?.ok) { drop('status'); continue; }
    if (!page.doc) { drop('not-html'); continue; }
    if (/noindex/i.test(page.doc.robots ?? '')) { drop('noindex'); continue; }
    const canonical = page.doc.canonical?.[0];
    if (canonical && !same(canonical, page.url)) { drop('canonical-elsewhere'); continue; }
    if (!allowed(page.url)) { drop('robots-disallowed'); continue; }
    keep.push(page.url);
  }

  // Linked, answered 200, HTML, and absent from the sitemap — the check that
  // reports them has already established every one of those.
  const added = findings
    .filter((f) => f.id === 'missing-from-sitemap' && f.url)
    .map((f) => f.url)
    .filter((url) => allowed(url) && !keep.some((k) => same(k, url)));

  const urls = [...new Set([...keep, ...added])].sort();
  if (urls.length === 0) {
    return refuse('No page in this crawl belongs in a sitemap, so there is nothing to write.');
  }

  const body = urls
    .map((url) => {
      const when = lastmod.get(url) ?? lastmod.get(url.replace(/\/$/, ''));
      return `  <url>\n    <loc>${escape(url)}</loc>` + (when ? `\n    <lastmod>${escape(when)}</lastmod>` : '') + '\n  </url>';
    })
    .join('\n');

  return {
    xml: '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + `${body}\n</urlset>\n`,
    urls,
    added,
    excluded,
    refused: null,
  };
}

function refuse(why) {
  return { xml: null, urls: [], added: [], excluded: {}, refused: why };
}

/** The summary line for a terminal, and for the note the CLI prints. */
export function describe(result, path) {
  if (result.refused) return `  Did not write ${path}: ${result.refused}\n`;
  const out = [`  wrote ${path} — ${result.urls.length} URLs`];
  if (result.added.length) {
    out.push(`    added   ${result.added.length}  (linked, and were missing from the sitemap)`);
  }
  for (const [reason, count] of Object.entries(result.excluded).sort((a, b) => b[1] - a[1])) {
    out.push(`    dropped ${String(count).padEnd(3)} (${REASONS[reason] ?? reason})`);
  }
  return out.join('\n') + '\n';
}

/** Which sitemap URLs changed since a date, and whether that can be answered.
 *
 *  A five-thousand-page site audited every week does not need five thousand
 *  requests: the sitemap already says which pages moved. The saving is real
 *  enough to be worth the two refusals below, both of which come from the same
 *  place — a `lastmod` nobody maintains is worse than none, because it looks
 *  like an answer.
 *
 *  A URL with no `lastmod` is **kept**. Not knowing when a page changed is not
 *  evidence that it did not, and the whole value of this is that the pages it
 *  skips are ones the site said are unchanged.
 */
export function changedSince(entries, since) {
  const cutoff = Date.parse(since);
  if (!Number.isFinite(cutoff)) {
    return { refused: `"${since}" is not a date. Pass one like 2026-08-17.` };
  }

  const dated = entries.filter((e) => e.lastmod && Number.isFinite(Date.parse(e.lastmod)));
  if (dated.length === 0) {
    return {
      refused:
        'No URL in this sitemap carries a lastmod, so there is nothing to compare a date against. ' +
        'Run without --since.',
    };
  }

  // One date on every URL is a build stamp, which is the thing crawlers learn
  // to ignore — and here it would mean checking everything or nothing
  // depending on which side of the stamp the date fell.
  const days = new Set(dated.map((e) => new Date(Date.parse(e.lastmod)).toISOString().slice(0, 10)));
  if (days.size === 1 && dated.length > 1) {
    return {
      refused:
        `Every dated URL in this sitemap carries ${[...days][0]}, which is a build stamp rather than ` +
        'a record of when each page changed. --since would check all of them or none of them.',
    };
  }

  const changed = [];
  const unknown = [];
  const skipped = [];
  for (const entry of entries) {
    const at = entry.lastmod ? Date.parse(entry.lastmod) : NaN;
    if (!Number.isFinite(at)) unknown.push(entry.loc);
    else if (at >= cutoff) changed.push(entry.loc);
    else skipped.push(entry.loc);
  }

  return { urls: [...changed, ...unknown], changed, unknown, skipped, refused: null };
}
