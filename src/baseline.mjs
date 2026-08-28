// Comparing one run against another.
//
// "How many warnings does this site have" is rarely the useful question, and
// after the first pass the answer stops changing. "Did this deploy break
// something that worked yesterday" is the question worth failing a build over.
import { causePayload } from './causes.mjs';

/** A finding's identity across runs: the check, and where it happened.
 *
 *  `where` is the whole URL when both runs are of the same site, and the path
 *  alone when they are not. Comparing a staging deployment with production is
 *  the same question as comparing yesterday with today — "did this change
 *  anything" — but every URL differs by its host, and keying on the whole URL
 *  answered it with every finding fixed and every finding added, which is no
 *  answer at all. `--against` has documented "hosts are ignored" since it
 *  shipped and passed an option `diff` never read. */
const key = (f, ignoreHost) => `${f.id}\u0000${ignoreHost ? path(f.url) : (f.url ?? '')}`;

/** The part of a URL that is the same page on two different hosts. The query
 *  stays: /search?q=a and /search?q=b are two pages. The fragment goes, since
 *  no server ever sees it. A URL that will not parse is compared as it is. */
function path(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    // A trailing slash is not a difference between deployments; one platform
    // serves /about and the next /about/.
    return `${parsed.pathname.replace(/\/$/, '') || '/'}${parsed.search}`;
  } catch {
    return url;
  }
}

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Compare two runs.
 *
 *  `ignoreHost` compares by path rather than by URL. Left unset it decides for
 *  itself, by asking whether the two runs are even of the same origin — the
 *  Mac app and the hosted `/diff` both post two whole runs and neither should
 *  have to know this rule. */
export function diff(previous, current, { ignoreHost, currentMeta } = {}) {
  const wasOrigin = previous.meta?.origin ?? originOf(previous.findings?.find((f) => f.url)?.url);
  const isOrigin = currentMeta?.origin ?? originOf(current.find((f) => f.url)?.url);
  const crossSite = ignoreHost ?? Boolean(wasOrigin && isOrigin && wasOrigin !== isOrigin);

  const before = new Map((previous.findings ?? []).map((f) => [key(f, crossSite), f]));
  const after = new Map(current.map((f) => [key(f, crossSite), f]));

  const added = current.filter((f) => !before.has(key(f, crossSite)));
  const fixed = [...before.values()].filter((f) => !after.has(key(f, crossSite)));
  const unchanged = current.length - added.length;

  return {
    added,
    fixed,
    unchanged,
    crossSite,
    previousDate: previous.meta?.date ?? 'the baseline',
  };
}

/** The run as JSON.
 *
 *  Two callers with different needs. A **baseline** is committed and diffed in
 *  git, so it carries the five fields a finding is identified by and nothing
 *  that moves on its own: how many links point at a page changes every time the
 *  site does, and a baseline whose git diff churns is a baseline nobody reads.
 *  A **report** carries everything the HTML shows, because something has to be
 *  able to rebuild it.
 *
 *  The shape is versioned either way, so a field added later can never make an
 *  old baseline silently mis-compare. */
export function serialize(findings, meta, { full = false, score } = {}) {
  return JSON.stringify(
    {
      version: 1,
      meta,
      findings: findings.map(({ level, id, title, detail, url, indexable, reach, traffic }) => ({
        level,
        id,
        title,
        detail,
        url,
        ...(full && indexable === false ? { indexable } : {}),
        ...(full && reach ? { reach } : {}),
        ...(full && traffic ? { traffic } : {}),
      })),
      // A report opens with the work, not the findings, everywhere it is read —
      // so a report that is read by a machine has to carry it too. Deliberately
      // absent from a baseline: grouping is derived from the findings a
      // baseline already holds, and it moves whenever page counts do, which is
      // the churn the baseline shape exists to avoid.
      ...(full ? { causes: causePayload(findings, meta.pages ?? 0) } : {}),
      // Deliberately absent from a baseline for the same reason as `causes`:
      // it is derived from the findings a baseline already holds, and it moves
      // whenever a page count does. A baseline whose git diff churns is a
      // baseline nobody reads.
      ...(full && score ? { score } : {}),
    },
    null,
    2,
  );
}

export function parse(text, path) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Baseline is not valid JSON (${path}): ${err.message}`);
  }
  if (!Array.isArray(data.findings)) {
    throw new Error(`Baseline has no findings array (${path}) — is it a --json report?`);
  }
  return data;
}
