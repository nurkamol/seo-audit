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
  { flag: '--limit', query: 'limit', app: true,
    field: { type: 'number', label: 'Pages at most', min: 1,
             help: 'A big site is minutes. Preview first if you are not sure this is the right one.' } },
  { flag: '--concurrency', query: 'concurrency', app: true,
    field: { type: 'select', label: 'Speed',
             // The same three the macOS window offers, so "Gentle" means the
             // same thing in both. The numbers live in one place.
             choices: [['', 'Normal — 6 at a time'], ['1', 'Gentle — one at a time, for a server that rate limits'],
                       ['12', 'Fast — 12 at a time, if you own the server']] } },
  { flag: '--check-external', query: 'external', app: true,
    field: { type: 'checkbox', label: 'Check outbound links too', value: '1',
             help: 'Slower, and other people\'s servers decide how much slower.' } },
  { flag: '--sitemap', query: 'sitemap', app: true,
    field: { type: 'url', label: 'Sitemap', placeholder: 'Found automatically',
             help: 'Only if robots.txt does not declare one and it is somewhere unusual.' } },
  { flag: '--browser', query: 'browser', app: true,
    field: { type: 'agent', label: 'Ask as', which: 'browser' } },
  { flag: '--os', query: 'os', app: true,
    field: { type: 'agent', label: 'On', which: 'os' } },
  { flag: '--user-agent', query: 'userAgent', app: true,
    field: { type: 'text', label: 'Or a user agent of your own', placeholder: 'Replaces the two menus above' } },
  { flag: '--search-console', query: 'search-console', app: true,
    // Reads somebody's Search Console, so it is only offered where the
    // deployment has said those credentials are the visitor's own.
    field: { type: 'text', label: 'Search Console property', placeholder: 'sc-domain:example.com',
             needs: 'ALLOW_SEARCH_CONSOLE',
             help: 'A domain property is named sc-domain:example.com, not by its URL.' } },
  { flag: '--write-sitemap', query: 'sitemap-out', app: true, via: 'the Export menu' },
  { flag: '--write-llms', query: 'llms-out', app: true, via: 'the Export menu' },
  { flag: '--write-schema', query: 'schema-out', app: true, via: 'the Export menu' },
  { flag: '--ignore', query: 'ignore', app: true, via: 'right-clicking a finding, and the Settings list',
    field: { type: 'text', label: 'Silence these checks', placeholder: 'og-webp, img-srcset',
             help: 'Check ids, comma separated. They are still counted, and the report says how many.' } },
  { flag: '--psi', query: 'psi', app: true, via: 'Settings → Performance',
    field: { type: 'text', label: 'Measure performance', placeholder: '/ or /blog/**',
             needs: 'ALLOW_PSI',
             help: 'Asks Google. A URL, a path, or a glob — and it spends the quota of whoever runs this.' } },
  { flag: '--psi-sample', query: 'psi-sample', app: true, via: 'Settings → Performance',
    field: { type: 'number', label: 'Pages to measure', min: 1, needs: 'ALLOW_PSI' } },
  { flag: '--psi-strategy', query: 'psi-strategy', app: true, via: 'Settings → Performance',
    field: { type: 'select', label: 'Measured as', needs: 'ALLOW_PSI',
             choices: [['', 'A phone — what Google indexes with'], ['desktop', 'A desktop']] } },
  { flag: '--since', query: null, app: 'not yet — it needs a date picker and a sense of when the last run was, which the window has in the library and does not offer yet' },
  { flag: '--exclude', query: null, app: 'not yet — a list of patterns needs somewhere to live in Settings, and one text field would be worse than nothing' },

  // --- reached another way ------------------------------------------------
  { flag: '--dry-run', query: null, app: true, via: 'the Preview button' },
  { flag: '--baseline', query: null, app: true, via: 'the Compare menu, over /diff' },
  { flag: '--json', query: null, app: true, via: 'the Export menu' },
  { flag: '--csv', query: null, app: true, via: 'the Export menu' },
  { flag: '--md', query: null, app: true, via: 'the Export menu' },
  { flag: '--html', query: null, app: true, via: 'the Export menu' },

  { flag: '--no-open', query: null, app: 'the window is the browser this would open — it spawns --serve itself and draws the report natively, and the pipe it hands over is what already stops a browser appearing' },

  // --- deliberately not in a window ---------------------------------------
  { flag: '--help', query: null, app: 'a window has no command line to explain' },
  { flag: '--version', query: null, app: 'the sidebar shows it, and offers every other one' },
  { flag: '--quiet', query: null, app: 'the crawl log is on screen while it runs' },
  { flag: '--verbose', query: null, app: 'the crawl log is on screen while it runs' },
  { flag: '--serve', query: null, app: 'the window is what --serve serves' },
  { flag: '--reports', query: null, app: 'the sidebar is this list, and it is always on' },
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

/** The controls a form should draw, in the order they are declared above.
 *
 *  Its own list rather than a second table: the hosted form used to hard-code
 *  two inputs while the engine took a dozen parameters, so somebody at a
 *  browser could reach a sixth of what somebody at a terminal could. Adding a
 *  flag with a `field` now adds the control, and a flag without one is simply
 *  not offered — which is a decision, written down beside the flag it is about.
 *
 *  `allow` answers the gates: PageSpeed spends somebody's quota and Search
 *  Console reads somebody's account, so neither is drawn unless the deployment
 *  has said those are the visitor's own to spend. */
export const formFields = (allow = () => true) =>
  OPTIONS.filter((o) => o.field && o.query && (!o.field.needs || allow(o.field.needs)))
    .map(({ flag, query, field }) => ({ flag, query, ...field }));

/** Everything the window does not reach, and why. Served so the answer is
 *  discoverable rather than only being in a source file. */
export const notInApp = () =>
  OPTIONS.filter((o) => o.app !== true).map(({ flag, app }) => ({ flag, reason: app }));
