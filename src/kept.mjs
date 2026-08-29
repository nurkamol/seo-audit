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

/** The columns a kept-runs list can be ordered by.
 *
 *  Named here rather than in the page so the sentence in a header link, the
 *  value in a URL and the comparison below cannot drift apart. `descFirst` is
 *  which direction a column should take when it is first clicked: dates and
 *  numbers are most useful largest-first, a site name is not.
 */
export const SORTS = {
  site: { label: 'Site', descFirst: false, of: (r) => String(r?.host ?? r?.site ?? '').toLowerCase() },
  when: { label: 'When', descFirst: true, of: (r) => String(r?.finishedAt ?? '') },
  pages: { label: 'Pages', descFirst: true, of: (r) => Number(r?.pages ?? 0) },
  causes: { label: 'To change', descFirst: true, of: (r) => Number(r?.causes ?? 0) },
  score: { label: 'Score', descFirst: true, of: (r) => (typeof r?.score === 'number' ? r.score : -1) },
};

/** Kept runs in the order asked for. Unknown columns fall back to the newest
 *  first, which is the order the library already hands them over in.
 *
 *  A copy, never in place: the caller's array is the store's own list, and
 *  sorting it underneath them would reorder a list somebody else is holding.
 *  Stable on ties by date then id, so two runs of one site at the same minute
 *  do not swap places between one request and the next. */
export function sortKept(rows, sort = 'when', dir = 'desc') {
  const column = SORTS[sort] ?? SORTS.when;
  const way = dir === 'asc' ? 1 : -1;
  return [...(rows ?? [])].sort((a, b) => {
    const left = column.of(a);
    const right = column.of(b);
    if (left < right) return -1 * way;
    if (left > right) return 1 * way;
    return (
      String(b?.finishedAt ?? '').localeCompare(String(a?.finishedAt ?? '')) ||
      String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
    );
  });
}

/** What a `sort`/`dir` pair means, with anything unrecognised refused rather
 *  than carried. These arrive from a URL and from a cookie, and a cookie is
 *  just a URL somebody kept — neither may name a column that does not exist. */
export function sortAsked(sort, dir) {
  const column = Object.hasOwn(SORTS, sort ?? '') ? sort : 'when';
  const way = dir === 'asc' || dir === 'desc' ? dir : SORTS[column].descFirst ? 'desc' : 'asc';
  return { sort: column, dir: way };
}

/** The name the remembered view is kept under. */
const VIEW_COOKIE = 'seo_audit_view';

/** What this browser last asked the kept-runs list to show.
 *
 *  A cookie rather than `localStorage` so the page needs no JavaScript to
 *  honour it — the filter and the sort are links and a form, and a preference
 *  that only works once a script has run would be the one control on the page
 *  that does not.
 *
 *  Everything is put back through the same validators the query string goes
 *  through. A cookie is a URL somebody kept, and it may have been edited since:
 *  it names a column or it is ignored. */
export function rememberedView(cookieHeader) {
  const raw = String(cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${VIEW_COOKIE}=`));
  if (!raw) return {};
  let asked;
  try {
    asked = new URLSearchParams(decodeURIComponent(raw.slice(VIEW_COOKIE.length + 1)));
  } catch {
    return {};
  }
  const since = asked.get('since') ?? '';
  const { sort, dir } = sortAsked(asked.get('sort'), asked.get('dir'));
  return {
    // A date that no longer parses is dropped rather than shown back as a
    // filter nobody can see the effect of.
    ...(since && !sinceWhen(since).error ? { since } : {}),
    sort,
    dir,
  };
}

/** That view, as a `Set-Cookie` value.
 *
 *  `SameSite=Lax` and no `Secure`, because the server this is served from is
 *  usually `http://127.0.0.1`. It holds a date and a column name — nothing
 *  worth protecting, and nothing worth sending anywhere else. */
export function rememberView({ since = '', sort = 'when', dir = 'desc' } = {}) {
  const value = new URLSearchParams();
  if (since) value.set('since', since);
  value.set('sort', sort);
  value.set('dir', dir);
  return `${VIEW_COOKIE}=${encodeURIComponent(value.toString())}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
