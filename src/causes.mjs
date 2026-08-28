// Findings grouped by the thing that has to change, rather than by the check
// that noticed it.
//
// A real store produced 2,081 findings across 347 URLs, and 1,685 of them were
// under /products/. Those are not 1,685 problems: they are one Shopify product
// template, repeated 194 times. Reporting them per check makes the reader
// derive that themselves, page after page, and most readers stop instead.
//
// The rule is deliberately one sentence long: **the same check, on pages of the
// same section, is one piece of work.** A section is the path a page's template
// lives under — /products/, /blogs/the-library/, / — because that is how a
// generated site is actually built, one template per shape of URL. Nothing here
// guesses at severity or invents a score; it groups, counts, and orders.

import { categoryOf } from './areas.mjs';

/** The template a URL belongs to: everything up to its last segment.
 *
 *  /products/blue-sage        → /products/
 *  /blogs/the-library/a-post  → /blogs/the-library/
 *  /about/                    → /
 *  https://x.test/            → /
 *
 *  A trailing slash is not a segment, so /about/ and /about are the same page
 *  in the same place, which is the one thing this must not get wrong. */
export function sectionOf(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return '/';
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return '/';
  // The last segment names the page; the ones before it name the template — but
  // only the first two of them. Past that a path is usually a date or a
  // taxonomy rather than a different template: jekyllrb.com's /news/2024/01/
  // would otherwise be its own section, one per month, and 1,206 findings
  // arrived as 602 "things to change" instead of a number anybody can act on.
  // Capping at two took its sections from 112 to 27 and left a Shopify store's
  // eight exactly as they were.
  return `/${segments.slice(0, Math.min(segments.length - 1, 2)).join('/')}/`;
}

const WORST_FIRST = { error: 0, warn: 1, info: 2 };

/** Findings as pieces of work, worst and widest first.
 *
 *  Each cause is `{ id, title, level, section, pages, findings, count }`, where
 *  `pages` is the distinct URLs affected and `count` is how many findings the
 *  cause accounts for — the two are different when one page trips a check
 *  several times.
 *
 *  Ordered by level, then by how many pages carry it, then by id so two runs of
 *  an unchanged site produce the same report and --baseline stays meaningful. */
export function byCause(findings) {
  const causes = new Map();
  for (const finding of findings ?? []) {
    const section = sectionOf(finding.url);
    const key = `${finding.id} ${section}`;
    const cause = causes.get(key) ?? {
      id: finding.id,
      title: finding.title,
      level: finding.level,
      section,
      findings: [],
    };
    cause.findings.push(finding);
    // A cause is as serious as the worst thing in it.
    if (WORST_FIRST[finding.level] < WORST_FIRST[cause.level]) {
      cause.level = finding.level;
      cause.title = finding.title;
    }
    causes.set(key, cause);
  }

  return [...causes.values()]
    .map((cause) => {
      const pages = [...new Set(cause.findings.map((f) => f.url).filter(Boolean))];
      // How much of the site points at the pages this cause is on, and how
      // close the nearest of them is to the homepage. Both are counts of links
      // that were actually read — nothing is weighted or scored.
      const measured = cause.findings.filter((finding) => finding.reach);
      const seen = new Set();
      let inlinks = 0;
      for (const finding of measured) {
        if (seen.has(finding.url)) continue;
        seen.add(finding.url);
        inlinks += finding.reach.inlinks;
      }
      const depths = measured.map((finding) => finding.reach.depth).filter((d) => d !== null);
      // Impressions are not a proxy for anything: where Search Console has been
      // asked, this is what these pages actually do in Google.
      const shown = new Set();
      let impressions = 0;
      const positions = [];
      for (const finding of cause.findings) {
        if (!finding.traffic || shown.has(finding.url)) continue;
        shown.add(finding.url);
        impressions += finding.traffic.impressions;
        if (typeof finding.traffic.position === 'number') positions.push(finding.traffic.position);
      }
      return {
        ...cause,
        pages,
        count: cause.findings.length,
        inlinks: measured.length ? inlinks : null,
        depth: depths.length ? Math.min(...depths) : null,
        impressions: shown.size ? impressions : null,
        // Where Google puts these pages on average. Measured, never estimated —
        // the only reason a ranking is allowed in this file at all. Best of the
        // set rather than the mean: a cause spanning a page at 3 and a page at
        // 60 is worth looking at because of the page at 3.
        position: positions.length ? Math.min(...positions) : null,
      };
    })
    .sort(
      (a, b) =>
        WORST_FIRST[a.level] - WORST_FIRST[b.level] ||
        // Measured traffic first where it is known, because it is the only
        // number here that is not a proxy. Then reach before breadth: a
        // template on twenty pages that four hundred links point at is more of
        // the site than one on fifty nobody visits.
        (b.impressions ?? -1) - (a.impressions ?? -1) ||
        (b.inlinks ?? -1) - (a.inlinks ?? -1) ||
        b.pages.length - a.pages.length ||
        a.id.localeCompare(b.id) ||
        a.section.localeCompare(b.section),
    );
}

/** One line of English for a cause, used by every report format so they cannot
 *  drift: what it is, and how much of the site it is on. */
export function causeScope(cause, totalPages) {
  const pages = cause.pages.length;
  if (pages <= 1) return cause.section === '/' ? 'once' : `on one page under ${cause.section}`;

  const where = cause.section === '/' ? 'across the site' : `under ${cause.section}`;
  const share =
    totalPages && pages / totalPages >= 0.5 ? `, ${Math.round((pages / totalPages) * 100)}% of the crawl` : '';
  const seen = cause.impressions
    ? `, ${cause.impressions.toLocaleString()} impressions in 28 days` +
      (cause.position ? `, best at position ${cause.position}` : '')
    : '';
  const reach = seen || (cause.inlinks ? `, ${cause.inlinks.toLocaleString()} links in` : '');
  const near =
    cause.depth === 0 ? ', starting at the homepage' : cause.depth === 1 ? ', one click from home' : '';
  return `${pages} pages ${where}${share}${reach}${near}`;
}

/** The grouping, in the shape a machine reading a report wants.
 *
 *  Every front end that emits JSON emits this — the CLI's `--json`, the
 *  Worker's `?format=json`, and so the Mac app that reads it. It exists as one
 *  function because two of them had assembled it inline and the third had not
 *  emitted it at all, which meant a report from the command line and a report
 *  from the hosted version were different documents. `scope` is rendered here
 *  rather than left to the caller for the same reason: it is the sentence the
 *  terminal, the HTML and the app all print, and a second phrasing of it in
 *  another language is exactly the drift this project refuses everywhere else. */
export function causePayload(findings, totalPages) {
  return byCause(findings).map((cause) => ({
    id: cause.id,
    title: cause.title,
    level: cause.level,
    section: cause.section,
    count: cause.count,
    pages: cause.pages,
    scope: causeScope(cause, totalPages),
    // Where Google puts the best of these pages, when Search Console was
    // asked. Travels with the cause so a native client can sort by it rather
    // than parsing it back out of the scope sentence.
    ...(cause.position ? { position: cause.position } : {}),
    // Which part of the site fixes this. The HTML report groups by it, so a
    // client drawing its own report groups by the same thing rather than
    // carrying a second copy of that table in another language.
    area: categoryOf(cause.id),
  }));
}
