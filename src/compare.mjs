// The same page, asked for twice by two different readers.
//
// A site that serves one thing to Googlebot and another to a browser is either
// cloaking or misconfiguring its bot protection, and both are invisible to an
// audit that fetches once. This asks a sample of pages again as somebody else
// and reports what changed.
//
// Deliberately not a byte comparison. A nonce, a timestamp, a cart count and a
// session id all differ between two fetches of the same page by the same
// client, and reporting those would drown the one case that matters. What is
// compared is what a search engine reads: the status, the title, the canonical,
// the indexing directives, and how much content and how many links there are.
import { parseHtml } from './parse.mjs';
import { Fetcher, mapLimit } from './http.mjs';

const f = (level, id, title, detail, url) => ({ level, id, title, detail, url });

/** Roughly, since a byte count would fire on a timestamp. Two pages within a
 *  tenth of each other are the same page as far as this is concerned. */
const materiallyDifferent = (a, b) => Math.abs(a - b) > Math.max(a, b) * 0.1;

/** What one reader was given that the other was not. */
function differences(mine, theirs) {
  const out = [];
  if (mine.status !== theirs.status) out.push(`HTTP ${mine.status} became HTTP ${theirs.status}`);
  if (!mine.doc || !theirs.doc) return out;

  if ((mine.doc.title ?? '') !== (theirs.doc.title ?? '')) {
    out.push(`the title changed from "${mine.doc.title ?? '(none)'}" to "${theirs.doc.title ?? '(none)'}"`);
  }
  const canonical = (d) => d.canonical?.[0] ?? '(none)';
  if (canonical(mine.doc) !== canonical(theirs.doc)) {
    out.push(`the canonical changed from ${canonical(mine.doc)} to ${canonical(theirs.doc)}`);
  }
  const robots = (d) => (d.robots ?? '(none)').toLowerCase();
  if (robots(mine.doc) !== robots(theirs.doc)) {
    out.push(`the robots meta changed from "${robots(mine.doc)}" to "${robots(theirs.doc)}"`);
  }
  if (materiallyDifferent(mine.doc.words, theirs.doc.words)) {
    out.push(`the page went from ${mine.doc.words} words to ${theirs.doc.words}`);
  }
  const links = (d) => d.links.internal.length;
  if (materiallyDifferent(links(mine.doc), links(theirs.doc))) {
    out.push(`the internal links went from ${links(mine.doc)} to ${links(theirs.doc)}`);
  }
  return out;
}

/** Re-fetch a sample of crawled pages as somebody else.
 *
 *  A sample rather than the whole crawl, because this doubles the request cost
 *  of every page it looks at, and because a site that cloaks does it to the
 *  template rather than to page 400 alone. The report says how many were
 *  compared so a sample never reads as a clean bill of health for the site. */
export async function compareAgents(pages, { agent, label, sample = 10, onProgress } = {}) {
  const live = pages.filter((p) => p.doc && p.res.ok);
  if (!live.length || !agent) return [];

  // Spread across the crawl rather than taking the first ten, which on a
  // sitemap ordered by date would be ten pages of one month.
  const step = Math.max(1, Math.floor(live.length / sample));
  const chosen = live.filter((_, i) => i % step === 0).slice(0, sample);

  const other = new Fetcher({ concurrency: 3, userAgent: agent });
  const results = await mapLimit(chosen, 3, async (page) => {
    const res = await other.get(page.url);
    onProgress?.({ phase: 'compare', status: res.status, ms: res.ms, url: page.url });
    const isHtml = /text\/html/i.test(res.headers.get('content-type') ?? '');
    return {
      page,
      theirs: { status: res.status, doc: res.ok && isHtml ? parseHtml(res.body, page.url) : null },
    };
  });

  const out = [];
  const changed = [];
  for (const { page, theirs } of results) {
    const diffs = differences({ status: page.res.status, doc: page.doc }, theirs);
    if (diffs.length) changed.push({ url: page.url, diffs });
  }

  for (const { url, diffs } of changed.slice(0, 5)) {
    out.push(f('warn', 'serves-differently', `This page is different when ${label} asks for it`,
      `${diffs.join('; ')}. A page that changes with the reader is either cloaking or bot protection ` +
        'misfiring, and Google indexes the version it was given, not the one a person sees.', url));
  }

  out.push(f('info', 'compare-sampled',
    changed.length
      ? `${changed.length} of ${chosen.length} sampled pages differ when ${label} asks`
      : `${chosen.length} pages were identical when ${label} asked`,
    changed.length
      ? `Compared ${chosen.length} pages spread across the crawl, not all ${live.length}, because this ` +
        'doubles the cost of every page it looks at. The rest were not compared.'
      : `Compared ${chosen.length} pages spread across the crawl. Status, title, canonical, robots meta, ` +
        'word count and link count all matched, which is what a site that is not cloaking looks like.',
    live[0].url));

  return out;
}
