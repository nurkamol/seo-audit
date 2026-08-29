// Which kept runs a date is asking for.
//
// Separate from `library.mjs` on purpose. That module opens files, so it
// imports `node:fs` — and the Worker, which shows the same list in a browser,
// has no filesystem and would not survive the import. These two functions are
// the part both sides need and the part that is pure, so they live where both
// can reach them. Web-standard only; nothing here may grow a Node built-in.

/** A date on the command line or in a query string, as a timestamp.
 *
 *  `2026-08-01` means midnight UTC that day, so `--reports 2026-08-01` includes
 *  everything from that day. A full ISO timestamp is taken as written.
 *
 *  Returns `{ error }` for anything it cannot read, and the callers refuse
 *  rather than carrying on: listing every run when somebody asked for one week
 *  is the quiet kind of wrong — it looks like an answer. */
export function sinceWhen(value) {
  if (value === undefined || value === null || value === '') return { at: null };
  const text = String(value).trim();
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(at)) {
    return { error: `a date like 2026-08-01 or a full timestamp, not "${text}"` };
  }
  return { at };
}

/** Kept runs finished on or after `at`, in the order they were given.
 *
 *  Pure, and web-standard: the CLI and the hosted list both call it, so the two
 *  cannot disagree about what "since" means — which is the drift this project
 *  refuses everywhere else. A run with no readable date is kept rather than
 *  dropped: an index written by an older version should not vanish from a
 *  filtered list without saying so. */
export function keptSince(rows, at) {
  if (at === null || at === undefined) return rows ?? [];
  return (rows ?? []).filter((row) => {
    const when = Date.parse(row?.finishedAt ?? '');
    return Number.isNaN(when) ? true : when >= at;
  });
}
