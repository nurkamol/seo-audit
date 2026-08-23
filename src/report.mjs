// Two renderings of the same findings: one for the terminal, one for a file
// you can commit, diff between runs, or send to a client.

import { byCause, causeScope, sectionOf } from './causes.mjs';
import { CATEGORIES, categoryOf } from './areas.mjs';

const COLOR = process.env.NO_COLOR === undefined && process.stdout.isTTY;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const blue = (s) => c('36', s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);

const MARK = { error: '✗', warn: '!', info: '·' };
const PAINT = { error: red, warn: yellow, info: blue };

/** Findings grouped by check, worst level first, biggest group first. */
/** The top of every report: the work, not the findings.
 *
 *  A real store produced 2,081 findings, and the first thing anyone needs to
 *  know is that they are 62 pieces of work and four of them are most of it.
 *  Shown when there is something to summarise — under a handful of causes the
 *  list below already reads as the summary. */
export function worstCauses(findings, limit = 8) {
  const causes = byCause(findings);
  return causes.length > limit + 2 ? causes.slice(0, limit) : [];
}

export function group(findings) {
  const order = { error: 0, warn: 1, info: 2 };
  const byId = new Map();
  for (const finding of findings) {
    const entry = byId.get(finding.id) ?? { ...finding, items: [] };
    entry.items.push(finding);
    entry.level = order[finding.level] < order[entry.level] ? finding.level : entry.level;
    byId.set(finding.id, entry);
  }
  return [...byId.values()].sort(
    (a, b) => order[a.level] - order[b.level] || b.items.length - a.items.length,
  );
}

export function counts(findings) {
  return {
    error: findings.filter((x) => x.level === 'error').length,
    warn: findings.filter((x) => x.level === 'warn').length,
    info: findings.filter((x) => x.level === 'info').length,
  };
}

export function terminal(findings, meta) {
  const lines = [];
  const n = counts(findings);

  lines.push('');
  lines.push(bold(`  ${meta.origin}`));
  lines.push(
    dim(
      `  ${meta.pages} pages · ${meta.requests} requests · ${(meta.ms / 1000).toFixed(1)}s` +
        (meta.ignored ? ` · ${meta.ignored} ignored` : ''),
    ),
  );
  lines.push('');

  if (!findings.length) {
    lines.push(`  ${c('32', '✓')} nothing to report`);
    lines.push('');
    return lines.join('\n');
  }

  const causes = worstCauses(findings);
  if (causes.length) {
    const total = byCause(findings).length;
    lines.push(dim(`  ── Start here ${'─'.repeat(46)}`));
    lines.push('');
    lines.push(dim(`  ${findings.length} findings are ${total} things to change. The widest:`));
    lines.push('');
    for (const cause of causes) {
      lines.push(
        `  ${PAINT[cause.level](MARK[cause.level])} ${bold(cause.title)}` +
          dim(`  ${causeScope(cause, meta.pages)}`),
      );
    }
    lines.push('');
  }

  for (const { name, entries } of byCategory(findings)) {
    lines.push(dim(`  ── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`));
    lines.push('');
    for (const entry of entries) {
      const paint = PAINT[entry.level];
      const count = entry.items.length;
      lines.push(
        `  ${paint(MARK[entry.level])} ${bold(entry.title)}${count > 1 ? dim(` ×${count}`) : ''}`,
      );
      // One example in full, then the other pages by URL only — the detail
      // repeats and the list is what you act on.
      lines.push(`    ${dim(entry.items[0].detail)}`);
      for (const item of entry.items.slice(0, 8)) {
        // A page Google will not index is a page whose problems cost nothing.
        const aside = item.indexable === false ? dim('  (not indexable)') : '';
        lines.push(`    ${dim('·')} ${item.url ?? ''}${aside}`);
      }
      if (count > 8) lines.push(`    ${dim(`… and ${count - 8} more`)}`);
      lines.push('');
    }
  }

  lines.push(
    `  ${red(`${n.error} error`)}  ${yellow(`${n.warn} warning`)}  ${blue(`${n.info} note`)}`,
  );
  lines.push('');
  return lines.join('\n');
}

export function markdown(findings, meta) {
  const n = counts(findings);
  const out = [];

  out.push(`# SEO audit — ${meta.origin}`);
  out.push('');
  out.push(
    `${meta.date} · ${meta.pages} pages crawled · **${n.error} errors, ${n.warn} warnings, ${n.info} notes**`,
  );
  out.push('');

  if (!findings.length) {
    out.push('Nothing to report.');
    out.push('');
    return out.join('\n');
  }

  const causes = worstCauses(findings);
  if (causes.length) {
    out.push('## Start here');
    out.push('');
    out.push(`${findings.length} findings are **${byCause(findings).length} things to change**. The widest:`);
    out.push('');
    out.push('| | What to change | Where |');
    out.push('|:-:|---|---|');
    for (const cause of causes) {
      out.push(`| ${MARK[cause.level]} | ${cause.title} | ${causeScope(cause, meta.pages)} |`);
    }
    out.push('');
  }

  out.push('## Summary');
  out.push('');
  out.push('| | Area | Finding | Pages |');
  out.push('|---|---|---|---:|');
  for (const { name, entries } of byCategory(findings)) {
    for (const entry of entries) {
      out.push(`| ${MARK[entry.level]} | ${name} | ${entry.title} | ${entry.items.length} |`);
    }
  }
  out.push('');

  for (const { name, entries } of byCategory(findings)) {
    out.push(`## ${name}`);
    out.push('');
    for (const entry of entries) {
      out.push(`### ${MARK[entry.level]} ${entry.title}`);
      out.push('');
      // Every item carries its own detail (word counts, filenames, hop
      // chains), so each line stands alone rather than repeating a shared
      // preamble that only fits the first one.
      for (const item of entry.items) {
        const aside = item.indexable === false ? ' _(not indexable)_' : '';
        out.push(`- ${item.url ?? ''}${aside}${item.detail ? `  \n  ${item.detail}` : ''}`);
      }
      out.push('');
    }
  }

  out.push('---');
  out.push('');
  out.push(
    'Performance and Core Web Vitals are deliberately not measured here — use ' +
      '[PageSpeed Insights](https://pagespeed.web.dev) and [WebPageTest](https://webpagetest.org), ' +
      'which run real browsers. Generated by [seo-audit](https://github.com/nurkamol/seo-audit).',
  );
  out.push('');
  return out.join('\n');
}

// --- Categories -------------------------------------------------------------
// Moved to areas.mjs, and re-exported here because this is where every caller
// already looks for them.
export { CATEGORIES, categoryOf } from './areas.mjs';


/** Findings grouped by category, in the fixed order above, worst first inside. */
export function byCategory(findings) {
  const buckets = new Map();
  for (const entry of group(findings)) {
    const name = categoryOf(entry.id);
    buckets.set(name, [...(buckets.get(name) ?? []), entry]);
  }
  const order = [...CATEGORIES, 'Other'];
  return [...buckets]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([name, entries]) => ({ name, entries }));
}

// --- Live progress ----------------------------------------------------------
// One line per event, written as it happens. Deliberately not a spinner or a
// redrawing counter: a long run is exactly the run whose output gets piped to a
// file or read back out of a CI log, and neither of those can show a cursor
// trick. Plain lines are also greppable, and make the page the crawl is stuck
// on visible rather than hidden behind an animation.

const statusColour = (status) => {
  if (status >= 500 || status === 0) return red;
  if (status >= 400) return red;
  if (status >= 300) return yellow;
  return dim;
};

/** A single progress line. `phase` names the stage; the rest is what happened. */
export function progressLine({ phase, status, ms, url, detail }, origin) {
  const parts = [dim(String(phase).padEnd(9))];

  if (status !== undefined) parts.push(statusColour(status)(String(status).padStart(3)));
  if (ms !== undefined) parts.push(dim(`${String(ms).padStart(5)}ms`));

  if (url) {
    // The origin is already on screen from the header, so a path reads better
    // in a long column. Anything off-origin keeps its host.
    let shown = url;
    if (origin && url.startsWith(origin)) shown = url.slice(origin.length) || '/';
    parts.push(shown);
  }
  if (detail) parts.push(status === undefined && !url ? detail : dim(detail));

  return `  ${parts.join('  ')}`;
}

// --- Portfolio --------------------------------------------------------------
// One command over several sites, and one table. The point is the comparison:
// which of the twenty sites regressed this week is a question no per-site
// report can answer, because each one only ever sees itself.

const host = (run) => {
  try {
    return new URL(run.meta.origin).host;
  } catch {
    return run.meta.origin ?? '?';
  }
};

/** Per-site tallies, worst site first — that is the row you act on. */
export function portfolioRows(runs) {
  return runs
    .map((run) => ({ host: host(run), run, n: counts(run.findings) }))
    .sort((a, b) => b.n.error - a.n.error || b.n.warn - a.n.warn || a.host.localeCompare(b.host));
}

export function portfolio(runs) {
  const rows = portfolioRows(runs);
  const lines = [''];
  const totals = rows.reduce(
    (acc, r) => ({
      error: acc.error + r.n.error,
      warn: acc.warn + r.n.warn,
      info: acc.info + r.n.info,
      pages: acc.pages + (r.run.meta.pages ?? 0),
      ms: acc.ms + (r.run.meta.ms ?? 0),
    }),
    { error: 0, warn: 0, info: 0, pages: 0, ms: 0 },
  );

  lines.push(
    bold(`  Portfolio — ${rows.length} sites`) +
      dim(` · ${totals.pages} pages · ${(totals.ms / 1000).toFixed(1)}s`),
  );
  lines.push('');

  const width = Math.max(4, ...rows.map((r) => r.host.length));
  const pad = (s, n) => String(s).padStart(n);
  lines.push(
    dim(`  ${'SITE'.padEnd(width)}  ${pad('PAGES', 5)}  ${pad('✗', 4)}  ${pad('!', 4)}  ${pad('·', 4)}`),
  );

  for (const { host: h, run, n } of rows) {
    // A site that never answered has no tallies worth lining up — say so in
    // the row rather than printing four zeros that look like a clean bill.
    const failed = run.meta.pages === 0;
    lines.push(
      `  ${h.padEnd(width)}  ${pad(run.meta.pages ?? 0, 5)}  ` +
        `${n.error ? red(pad(n.error, 4)) : dim(pad(0, 4))}  ` +
        `${n.warn ? yellow(pad(n.warn, 4)) : dim(pad(0, 4))}  ` +
        `${n.info ? blue(pad(n.info, 4)) : dim(pad(0, 4))}` +
        (failed ? dim('   — nothing crawled') : ''),
    );
  }

  lines.push('');
  const bad = rows.filter((r) => r.n.error).length;
  lines.push(
    bad
      ? `  ${red(`${totals.error} error${totals.error === 1 ? '' : 's'}`)} across ${bad} of ${rows.length} sites` +
          dim(`  ·  ${totals.warn} warnings  ·  ${totals.info} notes`)
      : `  ${c('32', '✓')} no errors across ${rows.length} sites` +
          dim(`  ·  ${totals.warn} warnings  ·  ${totals.info} notes`),
  );
  lines.push('');
  return lines.join('\n');
}

/** The same table, then each site's full report underneath it. */
export function portfolioMarkdown(runs) {
  const rows = portfolioRows(runs);
  const out = [];
  out.push('# SEO audit — portfolio');
  out.push('');
  out.push(`${runs[0]?.meta.date ?? ''} · ${rows.length} sites`);
  out.push('');
  out.push('| Site | Pages | Errors | Warnings | Notes |');
  out.push('|---|---:|---:|---:|---:|');
  for (const { host: h, run, n } of rows) {
    out.push(`| [${h}](${run.meta.origin}) | ${run.meta.pages ?? 0} | ${n.error} | ${n.warn} | ${n.info} |`);
  }
  out.push('');
  out.push('---');
  out.push('');
  // Each site's own report, unchanged, so a single site's section can be
  // lifted out and sent to whoever owns that site.
  for (const { run } of rows) out.push(markdown(run.findings, run.meta), '');
  return out.join('\n');
}

export function portfolioHtml(runs) {
  const rows = portfolioRows(runs);
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // Each site rendered by the existing single-site view, then spliced in below
  // the table — one file, and every section is the report that site would have
  // produced on its own.
  const sections = rows
    .map(({ run }) => {
      const body = html(run.findings, run.meta).match(/<main>([\s\S]*)<\/main>/)?.[1] ?? '';
      return `<section class="site" id="${esc(host(run))}">${body}</section>`;
    })
    .join('');

  const shell = html([], { origin: 'portfolio', date: runs[0]?.meta.date ?? '', pages: 0 });
  const table = `
  <h1>SEO audit — ${rows.length} sites</h1>
  <p class="meta">${esc(runs[0]?.meta.date ?? '')}</p>
  <table>
    <thead><tr><th>Site</th><th class="n">Pages</th><th class="n">Errors</th><th class="n">Warnings</th><th class="n">Notes</th></tr></thead>
    <tbody>${rows
      .map(
        ({ host: h, run, n }) =>
          `<tr><td><a href="#${esc(h)}">${esc(h)}</a></td><td class="n">${run.meta.pages ?? 0}</td>` +
          `<td class="n">${n.error}</td><td class="n">${n.warn}</td><td class="n">${n.info}</td></tr>`,
      )
      .join('')}</tbody>
  </table>
  ${sections}`;

  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>SEO audit — ${rows.length} sites</title>`)
    .replace(/<main>[\s\S]*<\/main>/, `<main>${table}</main>`);
}

/** Baseline comparison: what changed since the last run, and nothing else. */
export function diffReport({ added, fixed, unchanged, previousDate }) {
  const lines = [''];

  if (fixed.length) {
    lines.push(`  ${c('32', `✓ ${fixed.length} fixed since ${previousDate}`)}`);
    for (const item of fixed.slice(0, 10)) {
      lines.push(`    ${dim('·')} ${item.title} ${dim(item.url ?? '')}`);
    }
    if (fixed.length > 10) lines.push(`    ${dim(`… and ${fixed.length - 10} more`)}`);
    lines.push('');
  }

  if (added.length) {
    lines.push(`  ${red(`✗ ${added.length} new since ${previousDate}`)}`);
    for (const entry of group(added)) {
      lines.push(`    ${PAINT[entry.level](MARK[entry.level])} ${bold(entry.title)}`);
      lines.push(`      ${dim(entry.items[0].detail)}`);
      for (const item of entry.items.slice(0, 6)) lines.push(`      ${dim('·')} ${item.url ?? ''}`);
    }
    lines.push('');
  }

  if (!added.length && !fixed.length) {
    lines.push(`  ${c('32', '✓')} no change since ${previousDate} ${dim(`(${unchanged} known)`)}`);
    lines.push('');
  } else {
    lines.push(dim(`  ${unchanged} unchanged`));
    lines.push('');
  }

  return lines.join('\n');
}

/** Self-contained HTML — one file, no assets, safe to email or attach. */
/** Self-contained HTML — one file, no assets, safe to email or attach.
 *
 *  Everything is inline and nothing is fetched: no CDN, no webfont, no script.
 *  A report that needs the network to render is a report that renders blank in
 *  an email client, on a plane, or in three years' time when the CDN is gone.
 */
/** The findings as a spreadsheet: one row per finding, one column per thing
 *  somebody might sort or filter by.
 *
 *  A flat table on purpose. The grouped view is what the report is for; this is
 *  for the person who wants to sort 2,081 rows by impressions, hand a filtered
 *  slice to a developer, or paste the lot into a tracker. Anything that cannot
 *  survive a column — the shortest route to a deep page, the list of files a
 *  duplicate URL appears in — stays in `detail`, whole.
 *
 *  Written with a byte-order mark, which is the difference between Excel
 *  showing "Maison Éthérique" and showing "Maison Ã‰thÃ©rique". Every other
 *  reader ignores it. */
export function csv(findings, meta) {
  // RFC 4180: quote everything that could contain a delimiter, and double any
  // quote inside. Quoting every field is simpler than deciding per value, and
  // a spreadsheet cannot tell the difference.
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const columns = [
    'level', 'check', 'finding', 'page', 'section', 'indexable',
    'inlinks', 'clicks_from_home', 'impressions', 'clicks', 'detail',
  ];

  const rows = findings.map((finding) => [
    finding.level,
    finding.id,
    finding.title,
    finding.url ?? '',
    finding.url ? sectionOf(finding.url) : '',
    finding.indexable === false ? 'no' : 'yes',
    finding.reach?.inlinks ?? '',
    finding.reach?.depth ?? '',
    finding.traffic?.impressions ?? '',
    finding.traffic?.clicks ?? '',
    finding.detail,
  ]);

  return `\uFEFF${[columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function html(findings, meta, { backHref, backLabel = 'New audit' } = {}) {
  const n = counts(findings);
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const LABEL = { error: 'Error', warn: 'Warning', info: 'Note' };
  const HEADING = { error: 'Errors', warn: 'Warnings', info: 'Notes' };
  const groups = byCategory(findings);
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

  const section = ({ name, entries: list }) => {
    if (!list.length) return '';
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '-');
    return `
    <h2 id="${slug}"><span>${esc(name)}</span><span class="rule"></span><span class="tick">${list.length}</span></h2>
    ${list
      .map(
        (entry) => `
    <article class="finding ${entry.level}">
      <header>
        <span class="pill ${entry.level}">${LABEL[entry.level]}</span>
        <h3>${esc(entry.title)}</h3>
        ${entry.items.length > 1 ? `<span class="badge">${plural(entry.items.length, 'page')}</span>` : ''}
      </header>
      <code class="id">${esc(entry.id)}</code>
      <ul>
        ${entry.items
          .map(
            (item) => `<li>
          ${item.url ? `<a href="${esc(item.url)}">${esc(item.url)}</a>` : ''}
          ${item.indexable === false ? '<span class="noidx">not indexable</span>' : ''}
          <span class="detail">${esc(item.detail)}</span>
        </li>`,
          )
          .join('')}
      </ul>
    </article>`,
      )
      .join('')}`;
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SEO audit — ${esc(meta.origin)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fff;
    --panel: #fafafa;
    --fg: #0a0a0a;
    --muted: #666;
    --faint: #8f8f8f;
    --line: #eaeaea;
    --line-strong: #d4d4d4;
    --error: #c5292f;
    --warn: #a35200;
    --info: #0059c8;
    --error-bg: #fdf0f0;
    --warn-bg: #fdf4e7;
    --info-bg: #eef4ff;
    --ok: #0a7c42;
    --radius: 7px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000;
      --panel: #0e0e0e;
      --fg: #ededed;
      --muted: #a1a1a1;
      --faint: #7a7a7a;
      --line: #262626;
      --line-strong: #3a3a3a;
      --error: #ff6166;
      --warn: #f5a623;
      --info: #6ea8ff;
      --error-bg: #1c0d0e;
      --warn-bg: #1c1408;
      --info-bg: #0b1220;
      --ok: #3fcf7f;
    }
  }

  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    padding: 0 1.25rem 6rem;
    background: var(--bg);
    color: var(--fg);
    font: 400 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 62rem; margin-inline: auto; }
  a { color: inherit; }

  /* --- Masthead ------------------------------------------------------- */
  .bar {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    padding: 1.1rem 0; margin-bottom: 3rem;
    border-bottom: 1px solid var(--line);
  }
  .mark {
    font: 600 12.5px/1 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    letter-spacing: .02em; color: var(--fg); text-decoration: none;
  }
  .mark span { color: var(--faint); }
  .causes { margin: 0 0 3rem; }
  .causes .lede { color: var(--muted); margin: 0 0 1rem; font-size: .95rem; }
  .causes ol { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
  .causes li {
    display: flex; align-items: baseline; gap: .7rem; flex-wrap: wrap;
    padding: .7rem .9rem; border: 1px solid var(--line); border-radius: 8px;
  }
  .causes li b { font-weight: 600; }
  .causes .where { color: var(--muted); font-size: .88rem; margin-left: auto; }
  @media (max-width: 40rem) { .causes .where { margin-left: 0; width: 100%; } }

  .stamp {
    font: 500 12px/1 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    color: var(--faint); font-variant-numeric: tabular-nums;
  }
  /* Only rendered when a caller has somewhere to go back to — a report saved
     to disk does not. */
  .back {
    font: 500 12px/1 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    color: var(--faint); text-decoration: none; margin-left: auto; margin-right: 1rem;
  }
  .back:hover { color: var(--fg); }
  @media print { .back { display: none; } }

  h1 {
    font-size: 1.75rem; line-height: 1.2; font-weight: 600;
    letter-spacing: -.021em; margin: 0 0 .55rem;
  }
  h1 a { text-decoration: none; }
  h1 a:hover { text-decoration: underline; text-underline-offset: 3px; }

  .facts {
    display: flex; flex-wrap: wrap; gap: .4rem .95rem;
    margin: 0 0 2.25rem; padding: 0; list-style: none;
    font-size: .82rem; color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .facts li { display: flex; gap: .38rem; }
  .facts b { font-weight: 600; color: var(--fg); }

  /* --- Tally ---------------------------------------------------------- */
  .tally { display: grid; grid-template-columns: repeat(3, 1fr); gap: .7rem; margin: 0 0 3rem; }
  .tally div {
    border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--panel); padding: .9rem 1rem;
  }
  .tally b {
    display: block; font-size: 1.9rem; line-height: 1.1; font-weight: 600;
    letter-spacing: -.028em; font-variant-numeric: tabular-nums;
  }
  .tally small {
    display: block; margin-top: .18rem; font-size: .715rem; font-weight: 600;
    text-transform: uppercase; letter-spacing: .075em; color: var(--muted);
  }
  .tally .e b { color: var(--error); }
  .tally .w b { color: var(--warn); }
  .tally .i b { color: var(--info); }
  .tally .zero b { color: var(--faint); }

  /* --- Tables --------------------------------------------------------- */
  .scroll { overflow-x: auto; margin: 0 0 3.25rem; border: 1px solid var(--line); border-radius: var(--radius); }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  thead th {
    text-align: left; padding: .62rem .85rem;
    font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .075em;
    color: var(--muted); background: var(--panel); border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  tbody td { padding: .62rem .85rem; border-bottom: 1px solid var(--line); }
  tbody tr:last-child td { border-bottom: 0; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.n { color: var(--muted); }
  tbody a { text-decoration: none; font-weight: 500; }
  tbody a:hover { text-decoration: underline; text-underline-offset: 2px; }

  /* --- Pills ---------------------------------------------------------- */
  .pill {
    display: inline-block; flex: none;
    padding: .12rem .42rem; border-radius: 4px;
    font-size: .655rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
    border: 1px solid currentColor;
  }
  .pill.error { color: var(--error); background: var(--error-bg); }
  .pill.warn  { color: var(--warn);  background: var(--warn-bg); }
  .pill.info  { color: var(--info);  background: var(--info-bg); }

  /* --- Section headings ----------------------------------------------- */
  h2 {
    display: flex; align-items: center; gap: .8rem;
    font-size: .74rem; font-weight: 600; text-transform: uppercase; letter-spacing: .085em;
    color: var(--muted); margin: 0 0 1.1rem;
  }
  h2 .rule { flex: 1; height: 1px; background: var(--line); }
  h2 .tick { font-variant-numeric: tabular-nums; color: var(--faint); }

  /* --- Findings ------------------------------------------------------- */
  .finding {
    border: 1px solid var(--line); border-radius: var(--radius);
    margin: 0 0 .8rem; overflow: hidden; background: var(--bg);
  }
  .finding > header {
    display: flex; align-items: baseline; gap: .55rem; flex-wrap: wrap;
    padding: .8rem .95rem .1rem;
  }
  .finding h3 {
    font-size: .975rem; font-weight: 600; letter-spacing: -.011em;
    margin: 0; flex: 1 1 20rem;
  }
  .badge {
    font-size: .715rem; font-weight: 500; color: var(--muted);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .id {
    display: inline-block; margin: 0 .95rem .7rem;
    font: 500 .71rem/1 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    color: var(--faint);
  }
  .finding ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .finding li { padding: .55rem .95rem; border-bottom: 1px solid var(--line); }
  .finding li:last-child { border-bottom: 0; }
  .finding li a {
    font: 500 .8rem/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    text-decoration: none; word-break: break-word; color: var(--fg);
  }
  .finding li a:hover { text-decoration: underline; text-underline-offset: 2px; }
  .detail { display: block; color: var(--muted); font-size: .83rem; margin-top: .12rem; }
  .noidx {
    display: inline-block; margin-left: .4rem; padding: .04rem .34rem; border-radius: 4px;
    border: 1px solid var(--line-strong); color: var(--faint);
    font-size: .625rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
    vertical-align: 1px; white-space: nowrap;
  }

  /* --- Clean bill ------------------------------------------------------ */
  .clean {
    border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel);
    padding: 2.25rem 1.25rem; text-align: center;
  }
  .clean b { display: block; font-size: 1.05rem; font-weight: 600; color: var(--ok); }
  .clean span { color: var(--muted); font-size: .87rem; }

  /* --- Portfolio ------------------------------------------------------- */
  .site { margin: 0 0 4.5rem; }
  .site h1 { font-size: 1.25rem; }

  footer {
    margin-top: 4.5rem; padding-top: 1.15rem; border-top: 1px solid var(--line);
    color: var(--faint); font-size: .8rem; line-height: 1.7;
  }
  footer a { color: var(--muted); }

  @media (max-width: 34rem) {
    .tally { grid-template-columns: 1fr; }
    h1 { font-size: 1.4rem; }
  }
  /* Printing is how this reaches somebody who did not run it: ⌘P, save as
     PDF, send. The screen version is dark and scrolls forever; a page is
     neither, so the colours are forced light rather than left to a browser's
     "print backgrounds" setting, and nothing is allowed to break across a
     page boundary in the middle of a finding. */
  @media print {
    :root { --bg: #fff; --fg: #111827; --muted: #4b5563; --line: #d1d5db; --panel: #fff; }
    body { padding: 0; color: #000; background: #fff; font-size: 11pt; }
    @page { margin: 16mm 14mm; }
    .finding, .tally div, .scroll, .causes li, tr { break-inside: avoid; }
    h2 { break-after: avoid; }
    .bar { margin-bottom: 1.5rem; }
    footer { break-before: avoid; }
    /* The causes are the point of the first page, so the detail starts on the
       second one rather than trailing off the bottom of it. */
    .causes { break-after: page; }
    /* A link is useless on paper unless it says where it goes. Findings list
       full URLs already; this is for the ones written as link text. */
    .finding a[href^="http"]::after { content: " (" attr(href) ")"; font-size: .8em; color: #4b5563; word-break: break-all; }
    .back, .js-only { display: none !important; }
  }
</style>
</head>
<body>
<main>
  <div class="bar">
    <a class="mark" href="https://github.com/nurkamol/seo-audit">seo<span>-</span>audit</a>
    ${backHref ? `<a class="back" href="${esc(backHref)}">← ${esc(backLabel)}</a>` : ''}
    <span class="stamp">${esc(meta.date)}</span>
  </div>

  <h1><a href="${esc(meta.origin)}">${esc(meta.origin)}</a></h1>
  <ul class="facts">
    <li><b>${meta.pages ?? 0}</b> pages crawled</li>
    ${meta.requests ? `<li><b>${meta.requests}</b> requests</li>` : ''}
    ${meta.ms ? `<li><b>${(meta.ms / 1000).toFixed(1)}s</b> elapsed</li>` : ''}
    ${meta.ignored ? `<li><b>${meta.ignored}</b> silenced by config</li>` : ''}
    ${meta.notIndexable ? `<li><b>${meta.notIndexable}</b> pages not indexable</li>` : ''}
  </ul>

  ${(() => {
    const causes = worstCauses(findings);
    if (!causes.length) return '';
    return `<section class="causes">
    <h2 id="start-here"><span>Start here</span><span class="rule"></span><span class="tick">${byCause(findings).length}</span></h2>
    <p class="lede">${findings.length} findings are ${byCause(findings).length} things to change. The widest:</p>
    <ol>${causes
      .map(
        (cause) => `<li class="${cause.level}">
        <span class="pill ${cause.level}">${LABEL[cause.level]}</span>
        <b>${esc(cause.title)}</b>
        <span class="where">${esc(causeScope(cause, meta.pages))}</span>
      </li>`,
      )
      .join('')}</ol>
  </section>`;
  })()}

  <div class="tally">
    <div class="e${n.error ? '' : ' zero'}"><b>${n.error}</b><small>${n.error === 1 ? 'Error' : 'Errors'}</small></div>
    <div class="w${n.warn ? '' : ' zero'}"><b>${n.warn}</b><small>${n.warn === 1 ? 'Warning' : 'Warnings'}</small></div>
    <div class="i${n.info ? '' : ' zero'}"><b>${n.info}</b><small>${n.info === 1 ? 'Note' : 'Notes'}</small></div>
  </div>

  ${
    findings.length
      ? `<div class="scroll"><table>
    <thead><tr><th>Level</th><th>Area</th><th>Finding</th><th class="n">Pages</th></tr></thead>
    <tbody>${groups
      .flatMap(({ name, entries: list }) =>
        list.map(
          (e) =>
            `<tr><td><span class="pill ${e.level}">${LABEL[e.level]}</span></td>` +
            `<td><a href="#${name.toLowerCase().replace(/[^a-z]+/g, '-')}">${esc(name)}</a></td>` +
            `<td>${esc(e.title)}</td><td class="n">${e.items.length}</td></tr>`,
        ),
      )
      .join('')}</tbody>
  </table></div>
  ${groups.map(section).join('')}`
      : `<div class="clean"><b>Nothing to report</b><span>Every check passed on all ${meta.pages ?? 0} pages.</span></div>`
  }

  <footer>
    Correctness across every page. Performance is measured by Google via
    <a href="https://pagespeed.web.dev">PageSpeed Insights</a> when <code>--psi</code> is used, never estimated here.
    Generated by <a href="https://github.com/nurkamol/seo-audit">seo-audit</a>.
  </footer>
</main>
</body>
</html>
`;
}

/** What a `--dry-run` found, for the terminal.
 *
 *  Deliberately not a report: it has no findings in it, and printing it in the
 *  report's shape would suggest a crawl happened. */
export function dryRunReport(plan) {
  const out = [''];
  out.push(`  ${bold(plan.origin)}`);
  if (plan.redirected) {
    out.push(dim(`  ${plan.redirected.from}/ redirects here, so this is the host that would be read`));
  }

  if (!plan.reachable) {
    out.push('', `  ${red('Nothing answered.')} ${plan.rateLimited
      ? 'Every request came back HTTP 429 — wait, then try a lower --concurrency.'
      : 'The host did not return a single response.'}`);
    out.push('');
    return out.join('\n');
  }

  if (plan.sitemap) {
    out.push(dim(`  sitemap  ${plan.sitemap}`));
  } else {
    out.push('', `  ${yellow('No sitemap found.')} The crawl would follow links from the home page`);
    out.push(dim(`  instead, up to --limit ${plan.limit}. Tried: ${plan.tried.join(', ')}`));
    out.push('');
    return out.join('\n');
  }

  out.push('');
  out.push(`  ${bold(String(plan.listed))} URLs listed, ${bold(String(plan.wouldCheck))} would be checked`
    + (plan.skippedByLimit
      ? `, ${yellow(`${plan.skippedByLimit} past --limit ${plan.limit}`)}`
      : ''));

  if (plan.sections.length > 1) {
    out.push('');
    const width = Math.max(...plan.sections.map((s) => s.path.length));
    for (const section of plan.sections) {
      out.push(`    ${section.path.padEnd(width)}  ${dim(String(section.count))}`);
    }
  }

  out.push('');
  out.push(dim(`  first few: ${plan.sample.slice(0, 3).join(', ')}`));
  out.push(dim(`  ${plan.requests} requests, ${(plan.ms / 1000).toFixed(1)}s — no page was fetched`));
  out.push('');
  return out.join('\n');
}
