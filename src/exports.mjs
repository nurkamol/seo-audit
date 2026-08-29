// A report, in whatever shape somebody needs it.
//
// This owns none of the formats. `html()`, `markdown()` and `csv()` are the
// writers the command line calls for `--html`, `--md` and `--csv`; the
// corrected sitemap, the llms.txt and the structured data are whatever the run
// produced when it was asked. A file downloaded from the window and one written
// by `seo-audit --csv` are the same file, which is the rule that lets this
// project have five front ends.
//
// What it does own is the **list**: which formats exist, what they are called,
// and what a saved file is named. That was written out twice — once in the
// macOS app's `ExportFormat` and once in the Raycast extension — and a third
// copy for the served window would have been the point at which they started
// disagreeing about whether "Structured data" is called that.
//
// Web-standard only: no `node:fs` here, because the Worker imports it. Writing
// the file is the caller's job and differs per front end anyway — a browser
// downloads it, a launcher writes it to Downloads, a window opens a save panel.

import { html, markdown, csv } from './report.mjs';

/** Every shape a report can be written as, in the order somebody wants them. */
export const FORMATS = [
  { id: 'html', label: 'HTML report', extension: 'html', mime: 'text/html; charset=utf-8',
    detail: 'The full report, one file, opens in any browser.' },
  { id: 'markdown', label: 'Markdown', extension: 'md', mime: 'text/markdown; charset=utf-8',
    detail: 'For committing, or pasting into a ticket.' },
  { id: 'csv', label: 'Spreadsheet', extension: 'csv', mime: 'text/csv; charset=utf-8',
    detail: 'The whole checklist, one row each. For sorting and filtering.' },
  { id: 'json', label: 'JSON', extension: 'json', mime: 'application/json; charset=utf-8',
    detail: 'Everything, exactly as the engine produced it.' },
  { id: 'sitemap', label: 'Corrected sitemap', extension: 'xml', mime: 'application/xml; charset=utf-8',
    detail: 'The sitemap this site should have had.' },
  { id: 'llms', label: 'llms.txt', extension: 'txt', mime: 'text/plain; charset=utf-8',
    detail: "The llms.txt this site should have had, from its own words." },
  { id: 'schema', label: 'Structured data', extension: 'json', mime: 'application/json; charset=utf-8',
    detail: 'The JSON-LD this site could add, from what it already says.' },
];

export const formatById = (id) => FORMATS.find((format) => format.id === id) ?? null;

/** A file name somebody can find again, and that sorts. */
export function filenameFor(format, host, at = new Date()) {
  const spec = formatById(format);
  const stamp = at.toISOString().slice(0, 10);
  const safe = (host || 'report').replace(/[^a-z0-9.-]+/gi, '-');
  return `seo-audit-${safe}-${stamp}.${spec?.extension ?? 'txt'}`;
}

/** The report as text, or the reason there is none.
 *
 *  Three of these can legitimately be nothing, and the refusal is the useful
 *  half: the engine declines to build a sitemap from a crawl that did not see
 *  the whole site, declines an llms.txt for the same reason, and tells a site
 *  that already declares all the structured data it could write exactly that.
 *  Carrying the reason is the difference between "unavailable" and "here is
 *  why, and here is the run that would work". */
export function renderExport(format, report) {
  if (!report?.meta) return { text: null, refused: 'There is no report to write.' };

  const built = (held, text, what) => {
    if (!held) return { text: null, refused: `This run did not build ${what}.` };
    return { text, refused: text ? null : held.refused };
  };

  switch (format) {
    case 'html':
      return { text: html(report.findings ?? [], report.meta, { score: report.score }), refused: null };
    case 'markdown':
      return { text: markdown(report.findings ?? [], report.meta, { score: report.score }), refused: null };
    case 'csv':
      return { text: csv(report.findings ?? [], report.meta, { score: report.score }), refused: null };
    case 'json':
      return { text: JSON.stringify(report, null, 2), refused: null };
    case 'sitemap':
      return built(report.sitemap, report.sitemap?.xml, 'a sitemap');
    case 'llms':
      return built(report.llms, report.llms?.text, 'an llms.txt');
    case 'schema':
      return built(report.schema, report.schema?.json, 'any structured data');
    default:
      return { text: null, refused: `Unknown format "${format}".` };
  }
}
