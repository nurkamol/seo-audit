// Every flag, and whether the window can reach it.
//
// The command line grew thirty-two flags and the macOS window reached ten of
// them, and nothing anywhere said whether that was a decision or an oversight.
// It was both, in different places, and there was no way to tell which from
// outside — the same failure this project refuses in its reports, where a
// missing finding reads exactly like a passing one.
//
// So: one table, and a test that fails when a flag is added without an answer.
// `app: true` means the window reaches it. A **string** means it does not, and
// the string is the reason — "not yet" is a perfectly good reason, written
// down, and it stops being invisible.
//
// This is not a parser. `bin/seo-audit.mjs` still owns argument handling and
// `src/audit.mjs` still owns defaults; duplicating either here would create the
// second source of truth this file exists to prevent.

/**
 * `flag`   what the command line calls it
 * `query`  the /stream parameter the window sends on a run, when it sends one
 * `via`    how the window reaches it when it is not a run parameter
 * `app`    true, or the reason it is not reachable
 */
export const OPTIONS = [
  // --- what a run does ----------------------------------------------------
  { flag: '--limit', query: 'limit', app: true },
  { flag: '--concurrency', query: 'concurrency', app: true },
  { flag: '--check-external', query: 'external', app: true },
  { flag: '--sitemap', query: 'sitemap', app: true },
  { flag: '--browser', query: 'browser', app: true },
  { flag: '--os', query: 'os', app: true },
  { flag: '--user-agent', query: 'userAgent', app: true },
  { flag: '--search-console', query: 'search-console', app: true },
  { flag: '--write-sitemap', query: 'sitemap-out', app: true, via: 'the Export menu' },
  { flag: '--write-llms', query: 'llms-out', app: true, via: 'the Export menu' },
  { flag: '--write-schema', query: 'schema-out', app: true, via: 'the Export menu' },
  { flag: '--ignore', query: 'ignore', app: true, via: 'right-clicking a finding, and the Settings list' },
  { flag: '--psi', query: 'psi', app: true, via: 'Settings → Performance' },
  { flag: '--psi-sample', query: 'psi-sample', app: true, via: 'Settings → Performance' },
  { flag: '--psi-strategy', query: 'psi-strategy', app: true, via: 'Settings → Performance' },
  { flag: '--since', query: null, app: 'not yet — it needs a date picker and a sense of when the last run was, which the window has in the library and does not offer yet' },
  { flag: '--exclude', query: null, app: 'not yet — a list of patterns needs somewhere to live in Settings, and one text field would be worse than nothing' },

  // --- reached another way ------------------------------------------------
  { flag: '--dry-run', query: null, app: true, via: 'the Preview button' },
  { flag: '--baseline', query: null, app: true, via: 'the Compare menu, over /diff' },
  { flag: '--json', query: null, app: true, via: 'the Export menu' },
  { flag: '--csv', query: null, app: true, via: 'the Export menu' },
  { flag: '--md', query: null, app: true, via: 'the Export menu' },
  { flag: '--html', query: null, app: true, via: 'the Export menu' },

  // --- deliberately not in a window ---------------------------------------
  { flag: '--help', query: null, app: 'a window has no command line to explain' },
  { flag: '--version', query: null, app: 'the sidebar shows it, and offers every other one' },
  { flag: '--quiet', query: null, app: 'the crawl log is on screen while it runs' },
  { flag: '--verbose', query: null, app: 'the crawl log is on screen while it runs' },
  { flag: '--serve', query: null, app: 'the window is what --serve serves' },
  { flag: '--fail-on', query: null, app: 'a window has no exit code for a build to read' },
  { flag: '--update-baseline', query: null, app: 'a baseline is a file a repository commits' },
  { flag: '--config', query: null, app: 'a config file is a file a repository commits' },
  { flag: '--redirects', query: null, app: 'a migration map is a file a repository commits' },


  // --- not yet, and that is a decision rather than an oversight ------------
  { flag: '--search-console-login', query: null, app: 'no — it opens a browser and writes a credential to disk, which is a terminal errand, not a control in a window' },
  { flag: '--against', query: null, app: 'not yet — the window compares two kept runs instead of two live deployments' },
  { flag: '--compare-as', query: null, app: 'not yet — it fetches a sample of pages a second time, and the window has no control for spending that' },
  { flag: '--compare-sample', query: null, app: 'not yet — see --compare-as' },
  { flag: '--settle', query: null, app: 'not yet — waiting out a deploy that is still rolling out is a CI shape, not something somebody watches a window do' },
];

/** The parameters a client should send on a run, for one that wants to build
 *  its own controls rather than hard-code this list. */
export const runParameters = () =>
  OPTIONS.filter((o) => o.app === true && o.query).map(({ flag, query }) => ({ flag, query }));

/** Everything the window does not reach, and why. Served so the answer is
 *  discoverable rather than only being in a source file. */
export const notInApp = () =>
  OPTIONS.filter((o) => o.app !== true).map(({ flag, app }) => ({ flag, reason: app }));
