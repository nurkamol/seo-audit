// The llms.txt this site should have had.
//
// Sibling to `src/sitemap.mjs`, and built on the same premise: the crawl has
// already read every page's title, description, section and indexing
// directives, which is exactly what the file is made of. Nothing here is
// generated, guessed or rewritten — every line is a string the site already
// serves, and a page that gave us no description gets a line without one rather
// than a sentence somebody made up about it.
//
// The refusals matter more than the file, for the same reason they do next
// door: this is a document handed to an assistant as the authoritative summary
// of a site, and one built from a third of the site is worse than none, because
// it looks complete. So a truncated crawl writes nothing and says which run
// would.
//
// The format is llmstxt.org's: an H1 with the site's name, an optional blockquote
// summary, then H2 sections of `- [title](url): description` links. It is
// Markdown on purpose — the whole point is that the thing reading it does not
// need a parser.

import { sectionOf } from './causes.mjs';
import { plural } from './text.mjs';

/** Markdown's structural characters, inside text that came off a page.
 *
 *  A title containing `]` closes the link early and silently swallows the URL,
 *  which is the kind of thing that shows up on one product page out of four
 *  hundred and never in a test fixture. */
const clean = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/([[\]()])/g, '\\$1')
    .trim();

/** A page's own words, trimmed to a line. The description as written, never a
 *  summary of it: this file's whole claim is that it says what the site says. */
const summarise = (text, limit = 160) => {
  const line = clean(text);
  if (line.length <= limit) return line;
  // Cut at a word, not mid-syllable, and say it was cut.
  return `${line.slice(0, limit).replace(/\s+\S*$/, '')}…`;
};

/** Section headings, in the order a reader should meet them: the home page
 *  first, then the rest alphabetically so two runs of an unchanged site produce
 *  the same file and a diff means something. */
const HOME = '/';

/**
 * @param pages     what the crawl read: `[{ url, res, doc }]`
 * @param context   `{ origin, truncated, rateLimited, title, summary }`
 */
export function buildLlms(pages, context = {}) {
  const { origin = '', truncated = 0, rateLimited = 0 } = context;

  if (truncated > 0) {
    return refuse(
      `The crawl stopped at its limit with ${plural(truncated, 'URL')} unread, so this file would present a ` +
        `fraction of the site as the whole of it. Run again with --limit ${pages.length + truncated}.`,
    );
  }
  if (rateLimited > 0) {
    return refuse(
      `${plural(rateLimited, 'page')} were never read because the server was rate limiting, so what belongs ` +
        'in this file is not known. Run again with a lower --concurrency.',
    );
  }

  // The same rule the sitemap applies, for the same reason: a page that will
  // not be indexed, or that hands its identity to another page, is not one to
  // hand an assistant as somewhere to read.
  const excluded = {};
  const drop = (reason) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
    return false;
  };
  const usable = pages.filter((page) => {
    if (!page.res?.ok) return drop('status');
    if (!page.doc) return drop('not-html');
    if (/noindex/i.test(page.doc.robots ?? '')) return drop('noindex');
    const canonical = page.doc.canonical?.[0];
    if (canonical && canonical.replace(/\/$/, '') !== page.url.replace(/\/$/, '')) {
      return drop('canonical-elsewhere');
    }
    // A page with no title is a page this file cannot name, and a bare URL in a
    // list of links tells an assistant nothing it could not have guessed.
    if (!page.doc.title) return drop('no-title');
    return true;
  });

  if (!usable.length) {
    return refuse('No page in this crawl has a title and asks to be indexed, so there is nothing to write.');
  }

  // The site's own name for itself, from the home page, falling back to the
  // host. Never invented: an llms.txt whose H1 is a guess is a file that
  // introduces the site as something it does not call itself.
  const home = usable.find((page) => new URL(page.url).pathname.replace(/\/$/, '') === '');
  const host = (() => {
    try {
      return new URL(origin || usable[0].url).host;
    } catch {
      return origin;
    }
  })();
  const title = clean(context.title ?? home?.doc.title ?? host);
  const summary = summarise(context.summary ?? home?.doc.description ?? '', 300);

  // Grouped by the section a page's template lives under — the same
  // `sectionOf()` the report groups causes by, so the file's shape and the
  // report's shape are one decision made once.
  const bySection = new Map();
  for (const page of usable) {
    const section = sectionOf(page.url);
    bySection.set(section, [...(bySection.get(section) ?? []), page]);
  }

  const sections = [...bySection.keys()].sort((a, b) =>
    a === HOME ? -1 : b === HOME ? 1 : a.localeCompare(b),
  );

  const out = [`# ${title}`];
  if (summary) out.push('', `> ${summary}`);

  for (const section of sections) {
    const list = bySection.get(section).sort((a, b) => a.url.localeCompare(b.url));
    out.push('', `## ${section === HOME ? 'Pages' : section}`, '');
    for (const page of list) {
      const described = summarise(page.doc.description ?? '');
      out.push(`- [${clean(page.doc.title)}](${page.url})${described ? `: ${described}` : ''}`);
    }
  }

  return {
    text: `${out.join('\n')}\n`,
    urls: usable.map((page) => page.url),
    sections: sections.length,
    excluded,
    refused: null,
  };
}

function refuse(why) {
  return { text: null, urls: [], sections: 0, excluded: {}, refused: why };
}

const REASONS = {
  status: 'did not answer 200',
  'not-html': 'is not an HTML page',
  noindex: 'says noindex',
  'canonical-elsewhere': 'has a canonical pointing at another page',
  'no-title': 'has no title to name it by',
};

/** The summary line for a terminal, and for the note the CLI prints. */
export function describeLlms(result, path) {
  if (result.refused) return `  Did not write ${path}: ${result.refused}\n`;
  const out = [`  wrote ${path} — ${result.urls.length} pages in ${plural(result.sections, 'section')}`];
  for (const [reason, count] of Object.entries(result.excluded).sort((a, b) => b[1] - a[1])) {
    out.push(`    dropped ${String(count).padEnd(3)} (${REASONS[reason] ?? reason})`);
  }
  return out.join('\n') + '\n';
}
