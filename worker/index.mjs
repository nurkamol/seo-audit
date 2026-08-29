// A hosted front end for the audit the CLI runs, deployed to the reader's own
// Cloudflare account. Nothing here re-implements a check: it imports `audit`
// and `html` exactly as `bin/seo-audit.mjs` does, and its whole job is to take
// a URL from a form, stream the progress somewhere a browser can see it, and
// hand back the same self-contained report.
//
// Web-standard APIs only — `fetch`, `Request`, `Response`, `TransformStream`,
// all of which Node 22 has too. That is deliberate: it means this file is
// testable under `node --test` with nothing installed, which is the rule the
// rest of the project keeps.
//
// See docs/hosting.md for what it costs and what it is allowed to reach.
import { audit, preview } from '../src/audit.mjs';
import { html as htmlReport, markdown as markdownReport, csv as csvReport, reportParts } from '../src/report.mjs';
import { causePayload } from '../src/causes.mjs';
import { scoreRun, checklist, WEIGHT } from '../src/score.mjs';
import { diff } from '../src/baseline.mjs';
import { BROWSER_NAMES, OS_NAMES, userAgentFor } from '../src/agents.mjs';
import { runParameters, notInApp, formFields } from '../src/options.mjs';
import { FORMATS, formatById, filenameFor, renderExport } from '../src/exports.mjs';

// The CPU ceiling is what really bounds a run — roughly 25ms per page, against
// 30 seconds per invocation on the Paid plan. 150 pages is about four seconds
// of that, which leaves room for a slow site to be slow without the run being
// cut off mid-crawl. Raise it with the MAX_PAGES var if your site needs it.
const MAX_PAGES = 150;

const COOKIE = 'seo_audit_token';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Compare without leaking the answer in how long it took. */
export function sameSecret(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  // Nothing matches nothing. Two empty strings comparing equal is how an unset
  // secret turns into a bypass one refactor from now, and the emptiness of a
  // secret is not a fact worth hiding.
  if (!left || !right) return false;
  // Length is compared separately and early only because the loop below needs
  // a fixed number of iterations; the length of a secret is not the secret.
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

const cookies = (request) =>
  Object.fromEntries(
    (request.headers.get('cookie') ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name]) => name),
  );

/** Is this request allowed to run an audit?
 *
 *  A bearer token for anything scripted, a cookie for a browser that has
 *  already been through the unlock form. Never a query parameter: it would
 *  travel in the referer of every link in the report and sit in logs. */
export function authorized(request, env) {
  const secret = env.AUDIT_TOKEN;
  if (!secret) return false;
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return sameSecret(bearer, secret) || sameSecret(cookies(request)[COOKIE], secret);
}

/** The URL to audit, or why it was refused.
 *
 *  A deployed instance of this is a crawler with an address. ALLOWED_HOSTS is
 *  what keeps it from being a crawler anyone can point anywhere: set it, and
 *  the form will only ever fetch the sites named in it. */
export function targetFor(input, env) {
  let url;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    return { error: 'That is not a URL. It needs the scheme too: https://example.com' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: `Only http and https can be audited, not ${url.protocol}` };
  }
  const allowed = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(url.hostname.toLowerCase())) {
    return {
      error:
        `This deployment is limited to ${allowed.join(', ')}. Change ALLOWED_HOSTS to audit ` +
        'anything else, and read docs/hosting.md before you remove it entirely.',
    };
  }
  return { url: url.toString() };
}

/** How many pages this deployment will crawl, whatever the form asked for. */
/** Check ids, comma-separated. Bounded and pattern-checked: this ends up
 *  matched against every finding, and a list of ten thousand ids would be a way
 *  to make a run expensive. */
export function idList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]{1,60}$/.test(s))
    .slice(0, 100);
}

/** PageSpeed Insights, off unless the deployment allows it.
 *
 *  Every target is a call to Google that takes seconds and spends a quota, so
 *  on a hosted deployment a stranger could otherwise spend somebody's budget by
 *  passing a parameter. `--serve` sets ALLOW_PSI because the window it serves is
 *  the person running it. */
export function psiOptions(params, env) {
  if (env.ALLOW_PSI !== '1') return {};
  const targets = (params.get('psi') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!targets.length) return {};

  const asked = Number.parseInt(params.get('psi-sample') ?? '', 10);
  const strategy = params.get('psi-strategy');
  return {
    psi: targets,
    psiSample: Number.isFinite(asked) && asked > 0 ? Math.min(asked, 10) : undefined,
    psiStrategy: strategy === 'desktop' ? 'desktop' : 'mobile',
  };
}

/** The Search Console property a run should be ordered by.
 *
 *  Gated for a sharper reason than PageSpeed: the credentials belong to
 *  whoever is running the server, not to whoever sent the request. A deployed
 *  Worker honouring `?search-console=` would let a stranger name any property
 *  that account can read and get its impressions back in the report — somebody
 *  else's traffic data, from somebody else's Search Console. So it is off
 *  unless the runtime says otherwise, and `--serve` says otherwise only because
 *  it is bound to the loopback address and serves the person who started it.
 */
export function searchConsoleProperty(params, env) {
  if (env.ALLOW_SEARCH_CONSOLE !== '1') return {};
  const asked = (params.get('search-console') ?? '').trim();
  if (!asked) return {};
  // A property is `sc-domain:example.com` or a URL, and nothing else. Anything
  // shaped otherwise is not a property and is not worth a round trip.
  if (!/^(sc-domain:[a-z0-9.-]+|https?:\/\/[^\s]+)$/i.test(asked) || asked.length > 253) return {};
  return { searchConsole: asked };
}

/** How hard to crawl. Clamped, because a request parameter that sets how many
 *  connections a stranger's site receives is a parameter worth bounding — and
 *  because 1 is a real answer: a site answering 429 gets through at 1 and does
 *  not at 6. */
export function crawlConcurrency(requested, env) {
  const ceiling = Number.parseInt(env.MAX_CONCURRENCY ?? '', 10) || 12;
  const asked = Number.parseInt(requested ?? '', 10);
  if (!Number.isFinite(asked) || asked < 1) return 6;
  return Math.min(asked, ceiling);
}

/** A sitemap somewhere unusual, but only on the site being audited. An
 *  unchecked URL here would make this a fetcher for anything the host it runs
 *  on can reach, which is the whole shape of a server-side request forgery. */
export function sitemapOverride(requested, target) {
  if (!requested) return null;
  try {
    const asked = new URL(requested, target);
    return asked.host === new URL(target).host ? asked.toString() : null;
  } catch {
    return null;
  }
}

/** Who to say we are. The presets live in src/agents.mjs and are named here
 *  rather than spelled out, so there is one table of user-agent strings. An
 *  unknown name falls back to the deployment's own setting rather than being
 *  invented. */
export function agentFor(params, env) {
  // A string of somebody's own, which the presets cannot cover — an internal
  // crawler's name, or the exact agent a host is known to treat differently.
  // Bounded and stripped of control characters, because this ends up in a
  // request header: a newline in here would be header injection.
  const custom = (params.get('userAgent') ?? '').replace(/[\r\n\u0000-\u001f\u007f]/g, '').trim();
  if (custom) return custom.slice(0, 256);

  const browser = params.get('browser');
  const system = params.get('os');
  if (!browser || !BROWSER_NAMES.includes(browser)) return env.USER_AGENT;
  if (system && !OS_NAMES.includes(system)) return env.USER_AGENT;
  try {
    // `userAgentFor` returns { ua, ignoredOs } — the flag matters to the CLI,
    // which prints it; here only the string is wanted.
    return userAgentFor(browser, system ?? undefined)?.ua ?? env.USER_AGENT;
  } catch {
    // agents.mjs refuses combinations that cannot exist — Safari on Windows —
    // and a refusal is not a reason to fail a whole run.
    return env.USER_AGENT;
  }
}

export function pageLimit(requested, env) {
  const ceiling = Number.parseInt(env.MAX_PAGES ?? '', 10) || MAX_PAGES;
  const asked = Number.parseInt(requested ?? '', 10);
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, ceiling) : ceiling;
}

/** One progress event as a line of plain text. The terminal's version of this
 *  is in report.mjs and is full of ANSI colour, which a browser renders as
 *  mojibake rather than as colour. */
export function progressText({ phase, status, ms, url, detail }, origin) {
  const parts = [String(phase).padEnd(9)];
  if (status !== undefined) parts.push(String(status).padStart(3));
  if (ms !== undefined) parts.push(`${String(ms).padStart(5)}ms`);
  if (url) parts.push(origin && url.startsWith(origin) ? url.slice(origin.length) || '/' : url);
  if (detail) parts.push(detail);
  return parts.join('  ');
}

// A certificate's expiry cannot be read here. It needs a TLS socket whose
// peer certificate is inspectable, and the Workers runtime does not offer
// one — `node:tls` is only partially supported and this is one of the parts
// that is missing.
//
// The check is switched off rather than left to fail, and then *said*, because
// a report that quietly contains two checks fewer than the CLI's is a report
// that lies by omission. A missing finding reads exactly like a passing one.
/** Whether this runtime can open the socket a certificate is read over.
 *
 *  A missing finding reads exactly like a passing one, so the runtime that
 *  cannot run a check says so — and the runtime that can must not. `--serve`
 *  sets this because it is Node; a deployed Worker leaves it unset. */
export const canReadCertificates = (env) => env.CAN_READ_CERTIFICATES === '1';

const NO_CERTIFICATE_CHECK = {
  level: 'info',
  id: 'tls-not-checked',
  title: 'Certificate expiry was not checked',
  detail:
    'This report was produced by the hosted version, which cannot open the kind of connection that ' +
    'reads a certificate. Run the CLI against this site to include tls-expiring and tls-expired: ' +
    'npx github:nurkamol/seo-audit@v1',
};

/** A preset's name, as a person writes it. The *value* stays the engine's own
 *  token — `--browser googlebot-desktop` is what the command line takes, and a
 *  form that sent something prettier would be a second vocabulary to keep in
 *  step. This only changes what the menu reads. */
const readable = (name) =>
  ({ macos: 'macOS', ios: 'iOS', 'googlebot-desktop': 'Googlebot (desktop)' })[name]
    ?? name.charAt(0).toUpperCase() + name.slice(1);

/** The form's controls, from the one table that knows what a run can be told.
 *
 *  Drawn here rather than hard-coded: this page offered two inputs while the
 *  engine took a dozen parameters, so somebody at a browser reached a sixth of
 *  what somebody at a terminal did. Adding a flag with a `field` in
 *  `src/options.mjs` now adds the control.
 *
 *  Everything past the URL is inside a `<details>`. A form that opens with
 *  twelve inputs asks somebody to have an opinion about twelve things before
 *  they can audit anything, and the answer to all of them is already the right
 *  one — which is why none of them is sent unless it was changed. */
function controls(env) {
  const allow = (key) => env[key] === '1';
  const fields = formFields(allow);
  if (!fields.length) return '';

  const drawn = fields.map((field) => {
    const id = `f-${field.query}`;
    const label = `<label for="${esc(id)}">${esc(field.label)}</label>`;
    const help = field.help ? `<p class="fine">${esc(field.help)}</p>` : '';

    if (field.type === 'checkbox') {
      return `<div class="check"><input id="${esc(id)}" name="${esc(field.query)}" type="checkbox" ` +
        `value="${esc(field.value ?? '1')}"><label for="${esc(id)}">${esc(field.label)}</label></div>${help}`;
    }
    if (field.type === 'select') {
      const options = field.choices
        .map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`)
        .join('');
      return `${label}<select id="${esc(id)}" name="${esc(field.query)}">${options}</select>${help}`;
    }
    // The browser and system menus are the engine's own list, asked for rather
    // than copied — the same reason /agents exists.
    if (field.type === 'agent') {
      const names = field.which === 'browser' ? BROWSER_NAMES : OS_NAMES;
      const options = ['<option value="">Whatever the engine defaults to</option>']
        .concat(names.map((name) => `<option value="${esc(name)}">${esc(readable(name))}</option>`))
        .join('');
      return `${label}<select id="${esc(id)}" name="${esc(field.query)}">${options}</select>${help}`;
    }

    // Empty means "leave the default in the engine", which is the rule every
    // control here follows — so the placeholder has to say what that default
    // is, or a blank box reads as an unanswered question rather than as the
    // right answer already being in place.
    const isLimit = field.query === 'limit';
    const bound = isLimit ? pageLimit(null, env) : null;
    const placeholder = isLimit ? `${bound}` : field.placeholder;
    return `${label}<input id="${esc(id)}" name="${esc(field.query)}" type="${esc(field.type)}"` +
      `${field.min ? ` min="${field.min}"` : ''}${isLimit ? ` max="${bound}"` : ''}` +
      `${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${help}`;
  });

  return `<details><summary>Settings</summary>${drawn.join('')}</details>`;
}

/// The window, in a browser.
///
/// The macOS app is a sidebar of kept runs beside a report, and until now this
/// served a page with a form on it — the same engine behind two products that
/// did not resemble each other. This is that window's shape: the same sidebar,
/// the same library, the same report, on the two platforms the app does not
/// ship to.
///
/// It borrows the report's own stylesheet rather than inventing a second one,
/// so a report on screen and a report in a file are the same document. The
/// chrome around it is the only new CSS here.
const CHROME = `
  :root {
    --sidebar: 268px;
    --glass: color-mix(in srgb, var(--panel) 82%, transparent);
    --accent: #2563eb;
    --on-accent: #fff;
  }
  @media (prefers-color-scheme: dark) {
    :root { --accent: #2f6fe4; }
  }
  html, body { height: 100%; }
  body { margin: 0; padding: 0; overflow: hidden; }

  .app { display: grid; grid-template-columns: var(--sidebar) 1fr; height: 100vh; }

  /* --- The sidebar ---------------------------------------------------- */
  .side {
    display: flex; flex-direction: column; gap: .75rem;
    padding: 1rem .75rem; min-height: 0;
    background: var(--panel); border-right: 1px solid var(--line);
  }
  .side .new {
    display: block; text-align: center; text-decoration: none;
    padding: .7rem 1rem; border-radius: 12px; font-weight: 600; font-size: .92rem;
    background: color-mix(in srgb, var(--fg) 8%, transparent); color: var(--fg);
    border: 1px solid var(--line-strong);
  }
  .side .new:hover { background: color-mix(in srgb, var(--fg) 13%, transparent); }
  .side h2 {
    font-size: .68rem; text-transform: uppercase; letter-spacing: .07em;
    color: var(--faint); margin: .5rem 0 0; padding: 0 .5rem; font-weight: 600; border: 0;
  }
  .side .runs { overflow-y: auto; margin: 0 -.25rem; padding: 0 .25rem; flex: 1; min-height: 0; }
  .side .run {
    display: grid; grid-template-columns: 1fr auto; gap: .15rem .5rem; align-items: baseline;
    padding: .5rem .55rem; border-radius: 9px; text-decoration: none; color: inherit;
  }
  .side .run:hover { background: color-mix(in srgb, var(--fg) 7%, transparent); }
  .side .run[aria-current] { background: color-mix(in srgb, var(--fg) 11%, transparent); }
  /* Every cell placed. With only a row set on the chip, auto-placement put it
     in column one and pushed the host into column two — a stretched green bar
     beside a right-aligned name. */
  .side .run b {
    grid-column: 1; grid-row: 1; font-weight: 600; font-size: .87rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .side .run small {
    grid-column: 1; grid-row: 2; color: var(--faint); font-size: .74rem;
    font-variant-numeric: tabular-nums;
  }
  .side .chip {
    grid-column: 2; grid-row: 1 / span 2; align-self: center; justify-self: end;
    font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: .28rem .4rem; border-radius: 6px; font-variant-numeric: tabular-nums;
  }
  .chip.good { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
  .chip.fair { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
  .chip.poor { color: var(--error); background: color-mix(in srgb, var(--error) 14%, transparent); }
  .side .foot { font-size: .72rem; color: var(--faint); padding: 0 .5rem; }
  .side .foot a { color: var(--faint); }

  /* --- The stage ------------------------------------------------------- */
  .stage { overflow-y: auto; min-width: 0; }
  .stage > main { max-width: 62rem; margin-inline: auto; padding: 0 1.75rem 5rem; }

  /* The report's own masthead is the window's title bar here. */
  .stage .bar { padding-top: 1.4rem; }

  /* --- The one thing on an empty stage --------------------------------- */
  .hero { display: grid; place-items: center; min-height: 100vh; padding: 2rem; }
  .hero .inner { width: min(38rem, 100%); text-align: center; }
  .hero h1 { font-size: 2rem; letter-spacing: -.025em; margin: 0 0 .4rem; }
  .hero .sub { color: var(--muted); margin: 0 0 2rem; }
  .card {
    text-align: left; padding: 1.4rem; border-radius: 18px;
    border: 1px solid var(--line); background: var(--glass);
    backdrop-filter: blur(20px) saturate(140%);
  }
  .card label { display: block; font-weight: 600; margin: 1rem 0 .35rem; font-size: .85rem; }
  .card label:first-of-type { margin-top: 0; }
  .card input, .card select {
    width: 100%; padding: .68rem .8rem; font: inherit; color: inherit;
    background: color-mix(in srgb, var(--fg) 5%, transparent);
    border: 1px solid var(--line-strong); border-radius: 10px;
  }
  .card input:focus, .card select:focus { outline: 2px solid color-mix(in srgb, var(--info) 60%, transparent); outline-offset: 1px; }
  .card .fine { color: var(--faint); font-size: .78rem; margin: .3rem 0 0; line-height: 1.5; }
  .card details { margin-top: 1.1rem; border-top: 1px solid var(--line); padding-top: .35rem; }
  .card summary { cursor: pointer; font-weight: 600; font-size: .85rem; padding: .5rem 0; color: var(--muted); }
  .card summary:hover { color: var(--fg); }
  .card .check { display: flex; gap: .55rem; align-items: center; margin-top: 1rem; }
  .card .check input { width: auto; }
  .card .check label { margin: 0; font-weight: 400; font-size: .9rem; }
  .actions { display: flex; gap: .6rem; margin-top: 1.4rem; }
  /* Its own pair rather than the note colour, which is light enough in dark
     mode that white text on it is barely readable. A button's background and
     its text are one decision. */
  button, .cta {
    padding: .68rem 1.2rem; font: inherit; font-weight: 600; font-size: .92rem;
    border: 0; border-radius: 10px; background: var(--accent); color: var(--on-accent);
    cursor: pointer; text-decoration: none; display: inline-block;
  }
  button.secondary, .cta.secondary {
    background: color-mix(in srgb, var(--fg) 7%, transparent); color: var(--fg);
    border: 1px solid var(--line-strong);
  }
  button:hover { filter: brightness(1.08); }

  /* --- Running --------------------------------------------------------- */
  .log {
    white-space: pre-wrap; word-break: break-word; margin: 1.25rem 0 0;
    background: color-mix(in srgb, var(--fg) 4%, transparent);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 1rem; max-height: 22rem; overflow: auto;
    font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
  }
  .spinner {
    width: 15px; height: 15px; border-radius: 50%; display: inline-block;
    border: 2px solid var(--line-strong); border-top-color: var(--info);
    animation: spin .7s linear infinite; vertical-align: -2px; margin-right: .5rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }

  /* Save as … — a row of links, so a browser downloads them and the desktop
     shell inherits the whole thing without owning a control of its own. */
  .exports {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem .5rem;
    margin: 1.6rem 0 2rem; padding-bottom: 1.3rem;
    border-bottom: 1px solid var(--line);
    font-size: .82rem;
  }
  .exports span { color: var(--faint); }
  .exports a {
    color: var(--muted); text-decoration: none;
    padding: .25rem .55rem; border-radius: 7px;
    border: 1px solid var(--line); background: var(--panel);
  }
  .exports a:hover { color: var(--fg); border-color: var(--rule-firm); }

  @media (max-width: 52rem) {
    .app { grid-template-columns: 1fr; }
    .side { display: none; }
  }
`;

/** A run's score, as a chip class. The same thresholds `gradeOf()` uses, so a
 *  dial in the window and a chip here change colour at the same number. */
const tone = (score) => (score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor');

/** The sidebar: what the macOS window has down its left-hand side. */
function sidebar(env, currentId) {
  const runs = env.STORE?.list?.() ?? [];
  return `<aside class="side">
    <a class="new" href="/">+ New audit</a>
    ${runs.length ? '<h2>Reports</h2>' : ''}
    <div class="runs">${runs
      .map((run) => `<a class="run" href="/reports/${esc(run.id)}"${run.id === currentId ? ' aria-current="page"' : ''}>
        <b>${esc(run.host ?? '')}</b>
        ${typeof run.score === 'number'
          ? `<span class="chip ${tone(run.score)}">${run.score}</span>`
          : ''}
        <small>${esc(String(run.finishedAt ?? '').replace('T', ' ').slice(0, 16))} · ${run.pages ?? 0} pages</small>
      </a>`)
      .join('')}</div>
    ${runs.length > 1 ? '<a class="foot" href="/reports">Compare two runs →</a>' : ''}
    <span class="foot">Nothing leaves this machine.</span>
  </aside>`;
}

/** Every way this report can be saved, as links.
 *
 *  Links rather than a menu: a browser knows how to download one, and the
 *  desktop shell inherits it for free. A format the run did not build is still
 *  offered — following it lands on the reason, which is more use than a control
 *  that is missing without saying why. */
function exportBar(id) {
  return `<nav class="exports" aria-label="Save this report">
    <span>Save as</span>
    ${FORMATS.map((format) =>
      `<a href="/reports/${esc(id)}/export?as=${esc(format.id)}" title="${esc(format.detail)}">${esc(format.label)}</a>`,
    ).join('')}
  </nav>`;
}

/** A page inside the window. `main` is already the stage's content. */
function shell(title, main, env, { currentId, css = '' } = {}) {
  // The report's stylesheet, from the report itself. Rendering an empty one is
  // the cheapest way to ask for it and costs nothing worth measuring.
  const base = reportParts([], { origin: '', pages: 0, date: '' }).css;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${base}${CHROME}${css}</style>
</head><body>
<div class="app">
  ${sidebar(env, currentId)}
  <div class="stage">${main}</div>
</div>
</body></html>`;
}

const page = (title, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  p.sub { color: #6b7280; margin: 0 0 2rem; }
  label { display: block; font-weight: 600; margin: 1.25rem 0 .35rem; }
  select { width: 100%; padding: .6rem .7rem; font: inherit; border: 1px solid #9ca3af; border-radius: .4rem; background: transparent; color: inherit; }
  details { margin-top: 1.5rem; border-top: 1px solid #9ca3af40; padding-top: .5rem; }
  summary { cursor: pointer; font-weight: 600; padding: .4rem 0; }
  details[open] summary { margin-bottom: .5rem; }
  .check { display: flex; align-items: center; gap: .5rem; margin-top: 1.25rem; }
  .check input { width: auto; }
  .check label { margin: 0; font-weight: 400; }
  .fine { color: #6b7280; font-size: .85rem; margin: .35rem 0 0; }
  .row { display: flex; gap: .6rem; align-items: center; }
  button.secondary { background: transparent; color: inherit; border: 1px solid #9ca3af; }
  table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #9ca3af30; vertical-align: top; }
  th { font-weight: 600; white-space: nowrap; width: 12rem; }
  .cta { display: inline-block; padding: .6rem 1.1rem; font-weight: 600; border-radius: .4rem; background: #2563eb; color: #fff; text-decoration: none; }
  h2 { font-size: 1rem; margin: 2rem 0 .5rem; }
  td.pick { width: 2rem; }
  td.pick input { width: auto; }
  td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* Save as … — a row of links, so a browser downloads them and the desktop
     shell inherits the whole thing without owning a control. */
  .exports {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem .55rem;
    margin: 1.4rem 0 -1rem; padding-bottom: 1.2rem;
    border-bottom: 1px solid var(--line);
    font-size: .82rem;
  }
  .exports span { color: var(--faint); margin-right: .2rem; }
  .exports a {
    color: var(--muted); text-decoration: none;
    padding: .22rem .5rem; border-radius: 6px;
    border: 1px solid var(--line);
  }
  .exports a:hover { color: var(--fg); border-color: var(--rule-firm); background: var(--panel); }
  input { width: 100%; padding: .6rem .7rem; font: inherit; border: 1px solid #9ca3af; border-radius: .4rem; background: transparent; color: inherit; }
  button { margin-top: 1.25rem; padding: .6rem 1.1rem; font: inherit; font-weight: 600; border: 0; border-radius: .4rem; background: #2563eb; color: #fff; cursor: pointer; }
  pre { white-space: pre-wrap; word-break: break-word; background: #11182710; padding: 1rem; border-radius: .4rem; font: 13px/1.5 ui-monospace, monospace; }
  .warn { border-left: 3px solid #d97706; padding-left: 1rem; }
  code { font: 13px ui-monospace, monospace; background: #11182714; padding: .1rem .3rem; border-radius: .25rem; }
</style>
</head><body>${body}</body></html>`;

const htmlResponse = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

/** The whole Worker, with its two collaborators injectable so the routing and
 *  the gate can be tested without crawling anything. */
export async function handle(request, env, ctx, deps = {}) {
  const run = deps.audit ?? audit;
  const render = deps.report ?? htmlReport;
  const url = new URL(request.url);

  // Nothing about this instance should end up in an index — not the form, and
  // certainly not a report about someone's site.
  if (url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
  }

  // Deployed but never configured. Refusing to run is the only safe reading of
  // an unset secret: the alternative is an open crawler on someone's account,
  // and they would find out from the bill or from an abuse report.
  if (!env.AUDIT_TOKEN) {
    return htmlResponse(
      page('Not configured', `
        <h1>Not configured yet</h1>
        <p class="sub">This deployment will not audit anything until it has a password.</p>
        <div class="warn">
          <p>What you are running is a crawler with a public address. Without a secret, anyone who finds
          the URL can point it at any site, from your account and on your bill.</p>
          <p>Set one and it starts working:</p>
          <pre>npx wrangler secret put AUDIT_TOKEN</pre>
          <p>Or in the dashboard: <strong>Workers &amp; Pages → your Worker → Settings → Variables and
          Secrets → Add → Secret</strong>, named <code>AUDIT_TOKEN</code>.</p>
        </div>`),
      503,
    );
  }

  // The unlock form posts the secret rather than putting it in a link, so it
  // stays out of browser history, out of the referer header on every link in
  // the report, and out of the logs of whatever sits in front of this.
  if (url.pathname === '/unlock' && request.method === 'POST') {
    const form = await request.formData();
    if (!sameSecret(form.get('token'), env.AUDIT_TOKEN)) return unlockPage('That is not the password.', 401);
    return new Response(null, {
      status: 303,
      headers: {
        location: '/',
        'set-cookie': `${COOKIE}=${env.AUDIT_TOKEN}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
      },
    });
  }

  if (!authorized(request, env)) return unlockPage();

  if (url.pathname === '/') {
    return htmlResponse(shell('SEO audit', `
      <div class="hero"><div class="inner">
        <h1>Audit every page</h1>
        <p class="sub">Not just the homepage. Nothing leaves this machine.</p>
        <form class="card" action="/run">
          <label for="url">Site</label>
          <input id="url" name="url" type="url" placeholder="example.com" required autofocus>
          ${controls(env)}
          <div class="actions">
            <button type="submit">Audit</button>
            <button type="submit" formaction="/plan" class="secondary">Preview</button>
          </div>
        </form>
        <p class="fine" style="margin-top:1rem">Preview costs a handful of requests and says what a
          crawl would do. Every setting the command line takes is in Settings; the ones that are not
          are <a href="/options">listed with the reason</a>.</p>
      </div></div>`, env));
  }

  if (url.pathname === '/run') {
    const target = targetFor(url.searchParams.get('url'), env);
    if (target.error) {
      return htmlResponse(
        shell('Not audited', `<main><div class="bar"></div><h1>Not audited</h1>
          <p class="sub">${esc(target.error)}</p><p><a class="cta secondary" href="/">Back</a></p></main>`, env),
        400,
      );
    }
    // Everything the form collected, not the two parameters this used to
    // forward. A control somebody set and the engine never saw is worse than
    // no control: it is a setting that quietly does nothing, which is the
    // failure `src/options.mjs` exists to prevent on the other side of this.
    const carried = new URLSearchParams({ url: target.url });
    for (const { query } of formFields(() => true)) {
      const value = url.searchParams.get(query);
      if (value !== null && value !== '') carried.set(query, value);
    }
    carried.set('limit', String(pageLimit(url.searchParams.get('limit'), env)));
    // Always asked for, exactly as the macOS window asks. They are built from
    // per-page data that is gone by the time the report arrives — the sitemap
    // from every page's status and canonical, the other two from their titles
    // and descriptions — so a run that did not ask can never offer them later.
    //
    // Without this the Save-as links were permanently refused for anybody who
    // started a crawl from the browser, which is every Linux and Windows user.
    // The sitemap costs one already-cached request; the other two cost none.
    for (const wanted of ['sitemap-out', 'llms-out', 'schema-out']) carried.set(wanted, '1');
    const stream = `/stream?${carried}`;
    // The log is streamed rather than the page being held back, because an
    // audit takes a minute or two and a blank tab for that long reads as a
    // hang. The report replaces this page when it arrives.
    return htmlResponse(
      shell(`Auditing ${esc(target.url)}`, `
      <main>
        <div class="bar">
          <a class="mark" href="https://github.com/nurkamol/seo-audit">seo<span>-</span>audit</a>
        </div>
        <h1>${esc(target.url)}</h1>
        <p class="sub" id="status"><span class="spinner"></span>Crawling every page the sitemap
          lists. The report replaces this when it is done.</p>
        <pre class="log" id="log"></pre>
      </main>
        <script>
          const log = document.getElementById('log');
          const status = document.getElementById('status');
          const events = new EventSource(${JSON.stringify(stream)});
          events.addEventListener('progress', (e) => {
            log.textContent += JSON.parse(e.data) + '\\n';
            window.scrollTo(0, document.body.scrollHeight);
          });
          events.addEventListener('failed', (e) => {
            events.close();
            status.textContent = JSON.parse(e.data);
          });
          events.addEventListener('done', (e) => {
            events.close();
            document.open();
            document.write(JSON.parse(e.data));
            document.close();
          });
        </script>`, env),
    );
  }

  // The findings, handed back and rendered. The native app holds the JSON it
  // was streamed and asks for a format when somebody exports; re-rendering here
  // The same preview, as a page rather than as JSON. `/preview` answers a
  // client; this answers a person, and it is the button beside Audit — the
  // whole point of a preview is being reachable before the minutes are spent.
  if (url.pathname === '/plan') {
    const target = targetFor(url.searchParams.get('url'), env);
    if (target.error) {
      return htmlResponse(
        shell('Not previewed', `<main><div class="bar"></div><h1>Not previewed</h1>
          <p class="sub">${esc(target.error)}</p><p><a class="cta secondary" href="/">Back</a></p></main>`, env),
        400,
      );
    }
    const plan = await preview(target.url, {
      limit: pageLimit(url.searchParams.get('limit'), env),
      concurrency: crawlConcurrency(url.searchParams.get('concurrency'), env),
      sitemap: sitemapOverride(url.searchParams.get('sitemap'), target.url),
      userAgent: agentFor(url.searchParams, env),
    });

    const rows = [];
    if (!plan.reachable) {
      rows.push(['Nothing answered', plan.rateLimited
        ? 'Every request came back HTTP 429. Wait, or set the speed to Gentle.'
        : `${plan.origin} did not return a single response.`]);
    } else {
      if (plan.redirected) {
        rows.push(['Would read', `${plan.origin} — ${plan.redirected.from} redirects there`]);
      }
      rows.push(['Sitemap', plan.sitemap ?? 'none found; links would be followed from the home page']);
      if (plan.listed) rows.push(['URLs listed', plan.listed.toLocaleString()]);
      rows.push(['Would check', plan.wouldCheck === null
        ? `up to ${plan.limit}, since there is no sitemap to count`
        : plan.wouldCheck.toLocaleString()]);
      if (plan.skippedByLimit) {
        rows.push(['Past the limit', `${plan.skippedByLimit.toLocaleString()} — raise "Pages at most"`]);
      }
      if (plan.excluded) rows.push(['Excluded', plan.excluded.toLocaleString()]);
      for (const section of plan.sections ?? []) {
        rows.push([section.path, `${section.count.toLocaleString()} URL${section.count === 1 ? '' : 's'}`]);
      }
    }
    rows.push(['This preview cost', `${plan.requests} requests, ${(plan.ms / 1000).toFixed(1)}s — no page was fetched`]);

    const audit = new URLSearchParams(url.searchParams);
    return htmlResponse(
      shell(`Preview — ${esc(target.url)}`, `
      <main>
        <div class="bar">
          <a class="mark" href="https://github.com/nurkamol/seo-audit">seo<span>-</span>audit</a>
        </div>
        <h1>${esc(target.url)}</h1>
        <p class="sub">What a crawl would do, without doing it.</p>
        <div class="scroll"><table>${rows
          .map(([name, value]) => `<tr><th>${esc(name)}</th><td>${esc(value)}</td></tr>`)
          .join('')}</table></div>
        <p class="actions"><a class="cta" href="/run?${audit}">Audit it</a>
          <a class="cta secondary" href="/">Change something</a></p>
      </main>`, env),
    );
  }

  // What a run would do, without doing it. A handful of requests instead of
  // hundreds, so somebody can find out whether the tool is pointed at the right
  // site before spending the minutes — and, on the hosted version, before
  // spending somebody's Workers budget.
  if (url.pathname === '/preview') {
    const target = targetFor(url.searchParams.get('url'), env);
    if (target.error) return new Response(target.error, { status: 400 });
    const plan = await preview(target.url, {
      limit: pageLimit(url.searchParams.get('limit'), env),
      concurrency: crawlConcurrency(url.searchParams.get('concurrency'), env),
      sitemap: sitemapOverride(url.searchParams.get('sitemap'), target.url),
      userAgent: agentFor(url.searchParams, env),
    });
    return new Response(JSON.stringify(plan), { headers: { 'content-type': 'application/json' } });
  }

  // Two runs of the same site, and what moved between them. `diff()` lives in
  // src/baseline.mjs and is what `--baseline` has always used; sending the two
  // sets here rather than comparing them in the client means there is one
  // answer to "did this get better", not one per front end. No crawl happens.
  if (url.pathname === '/diff' && request.method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response('That body is not JSON.', { status: 400 });
    }
    if (!Array.isArray(payload?.previous?.findings) || !Array.isArray(payload?.current?.findings)) {
      return new Response('Expected { previous: { meta, findings }, current: { meta, findings } }.', {
        status: 400,
      });
    }

    // `currentMeta` so `diff` can see that the two runs are of different
    // origins and compare by path — staging against production is the same
    // question as yesterday against today, and until it was passed, every
    // finding read as both fixed and added.
    const { added, fixed, unchanged, previousDate, crossSite } = diff(
      payload.previous,
      payload.current.findings,
      { currentMeta: payload.current.meta },
    );
    // Grouped by the same causePayload() everything else uses, so a regression
    // reads as one thing to fix rather than as forty rows.
    const pages = payload.current.meta?.pages ?? 0;
    return new Response(
      JSON.stringify({
        previousDate,
        unchanged,
        crossSite,
        added: { findings: added, causes: causePayload(added, pages) },
        fixed: { findings: fixed, causes: causePayload(fixed, payload.previous.meta?.pages ?? 0) },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  // --- Runs this machine has kept ----------------------------------------
  // Only where a store was handed over, which is the local server and never a
  // deployed Worker. The list, one report, and a comparison between two — the
  // three things the macOS window has had since 1.23.0 and the browser has not.
  if (url.pathname === '/reports' && env.STORE) {
    const rows = env.STORE.list();
    if (!rows.length) {
      return htmlResponse(shell('Reports', `
        <div class="hero"><div class="inner">
          <h1>Nothing kept yet</h1>
          <p class="sub">Every finished run is kept in <code>${esc(env.STORE.where())}</code>.</p>
          <p><a class="cta" href="/">Audit a site</a></p>
        </div></div>`, env));
    }

    // A comparison needs two, so the list is a form: tick two, press Compare.
    const grouped = new Map();
    for (const row of rows) grouped.set(row.host, [...(grouped.get(row.host) ?? []), row]);

    const body = [...grouped]
      .map(([host, runs]) => `<h2>${esc(host)}</h2><table>${runs
        .map((row) => `<tr>
          <td class="pick"><input type="checkbox" name="run" value="${esc(row.id)}"></td>
          <td><a href="/reports/${esc(row.id)}">${esc(String(row.finishedAt).replace('T', ' ').slice(0, 16))}</a></td>
          <td>${row.pages} pages · ${row.causes} thing${row.causes === 1 ? '' : 's'} to change</td>
          <td class="n">${typeof row.score === 'number' ? `${row.score}/100` : '—'}</td>
        </tr>`)
        .join('')}</table>`)
      .join('');

    return htmlResponse(shell('Reports', `
      <main>
        <div class="bar">
          <a class="mark" href="https://github.com/nurkamol/seo-audit">seo<span>-</span>audit</a>
        </div>
        <h1>Reports</h1>
        <p class="sub">${rows.length} kept on this machine,
          ${env.STORE.bytes ? `${Math.max(1, Math.round(env.STORE.bytes() / 1024))} KB in ` : 'in '}
          <code>${esc(env.STORE.where())}</code>.</p>
        <form action="/compare">
          ${body}
          <p class="actions"><button type="submit">Compare the two you ticked</button>
            <a class="cta secondary" href="/">Audit another site</a></p>
          <p class="fine">Two runs of one site answer "did my fix work". Two runs of different
            sites are matched by path instead, which is how a rebuild is compared with the site
            it replaces.</p>
        </form>
      </main>`, env));
  }

  // A kept report, as a file. The macOS window has had an Export menu since it
  // shipped and the browser had none, so somebody on Linux could read a report
  // and not save one. A download rather than a native dialog on purpose: it
  // works in a plain browser as well as in the desktop shell, and the shell
  // gaining a control the served UI lacks is the one thing it must not do.
  if (url.pathname.startsWith('/reports/') && url.pathname.endsWith('/export') && env.STORE) {
    const id = url.pathname.slice('/reports/'.length, -'/export'.length);
    const kept = env.STORE.read(id);
    const format = formatById(url.searchParams.get('as') ?? '');
    if (!kept || !format) return new Response('No such report or format.', { status: 404 });

    const { text, refused } = renderExport(format.id, kept);
    if (!text) {
      // The refusal is the useful half, so it is shown rather than downloaded
      // as an empty file — which would look like a working export.
      return htmlResponse(shell(format.label, `<main><div class="bar"></div>
        <h1>No ${esc(format.label.toLowerCase())} to save</h1>
        <p class="sub">${esc(refused ?? 'This run did not build one.')}</p>
        <p><a class="cta secondary" href="/reports/${esc(id)}">Back to the report</a></p></main>`, env), 409);
    }

    let host = kept.meta?.origin ?? 'report';
    try {
      host = new URL(kept.meta.origin).host;
    } catch {
      /* keep whatever it was */
    }
    return new Response(text, {
      headers: {
        'content-type': format.mime,
        'content-disposition': `attachment; filename="${filenameFor(format.id, host)}"`,
      },
    });
  }

  if (url.pathname.startsWith('/reports/') && env.STORE) {
    const kept = env.STORE.read(url.pathname.slice('/reports/'.length));
    if (!kept) {
      return htmlResponse(shell('Not found', `<main><div class="bar"></div><h1>No such report</h1>
        <p class="sub">It may have been dropped to keep the list a list.</p>
        <p><a class="cta secondary" href="/reports">All reports</a></p></main>`, env), 404);
    }
    const id = url.pathname.slice('/reports/'.length);
    const parts = reportParts(kept.findings ?? [], kept.meta, { score: kept.score });
    return htmlResponse(shell(parts.title, `<main>${exportBar(id)}${parts.body}</main>`, env, {
      currentId: id,
    }));
  }

  if (url.pathname === '/compare' && env.STORE) {
    const picked = url.searchParams.getAll('run');
    if (picked.length !== 2) {
      return htmlResponse(shell('Compare', `<main><div class="bar"></div><h1>Pick two</h1>
        <p class="sub">A comparison is between two runs; ${picked.length} ${picked.length === 1 ? 'was' : 'were'} ticked.</p>
        <p><a class="cta secondary" href="/reports">Back to the list</a></p></main>`, env), 400);
    }
    const [a, b] = picked.map((id) => env.STORE.read(id));
    if (!a || !b) {
      return htmlResponse(shell('Compare', `<main><div class="bar"></div><h1>One of those is gone</h1>
        <p><a class="cta secondary" href="/reports">Back to the list</a></p></main>`, env), 404);
    }
    // Older first, so "what moved" moves forward in time whichever order the
    // boxes were ticked in.
    const [before, after] = String(a.meta?.date ?? '') <= String(b.meta?.date ?? '') ? [a, b] : [b, a];
    const { added, fixed, unchanged, crossSite } = diff(before, after.findings ?? [], {
      currentMeta: after.meta,
    });

    const list = (title, note, causes) => causes.length
      ? `<h2>${esc(title)} · ${causes.length}</h2><p class="fine">${esc(note)}</p><table>${causes
          .map((cause) => `<tr><th>${esc(cause.level)}</th><td>${esc(cause.title)}</td>
            <td>${esc(cause.scope)}</td></tr>`)
          .join('')}</table>`
      : '';

    return htmlResponse(shell('Compare', `
      <main>
        <div class="bar">
          <a class="mark" href="https://github.com/nurkamol/seo-audit">seo<span>-</span>audit</a>
        </div>
        <h1>${esc(before.meta?.origin ?? '')} → ${esc(after.meta?.origin ?? '')}</h1>
        <p class="sub">${esc(String(before.meta?.date ?? ''))} compared with ${esc(String(after.meta?.date ?? ''))}${
          crossSite ? ' · matched by path, since the hosts differ' : ''
        }</p>
        ${list('Appeared', 'Not there last time. Start here.', causePayload(added, after.meta?.pages ?? 0))}
        ${list('Gone', 'Reported last time and not this time.', causePayload(fixed, before.meta?.pages ?? 0))}
        ${!added.length && !fixed.length ? '<p>Nothing moved.</p>' : ''}
        <p class="fine">${unchanged} finding${unchanged === 1 ? '' : 's'} unchanged, and not listed —
          a comparison is for what moved.</p>
        <p><a class="cta secondary" href="/reports">All reports</a></p>
      </main>`, env));
  }

  // Every check the score counts, with what it costs and what it says when it
  // passes. Served for the same reason as /options: "what does this thing
  // actually check" should be a question with a fetchable answer rather than
  // one that needs a source file read, and a client drawing its own checklist
  // asks rather than carrying a second copy of the table in another language.
  if (url.pathname === '/checks') {
    return new Response(JSON.stringify({ weights: WEIGHT, checks: checklist() }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // What a run can be told to do, and what the window does not reach yet, with
  // the reason. Served rather than only living in a source file, so "can the
  // app do X" is a question with an answer somebody can fetch.
  if (url.pathname === '/options') {
    return new Response(JSON.stringify({ run: runParameters(), notInApp: notInApp() }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // Which browsers and systems can be pretended to be. A client building a menu
  // asks rather than carrying its own copy of the list, so adding a preset to
  // src/agents.mjs adds it everywhere instead of in one place and then, later
  // and differently, in another.
  if (url.pathname === '/agents') {
    return new Response(JSON.stringify({ browsers: BROWSER_NAMES, systems: OS_NAMES }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // means every writer stays in src/report.mjs and the app owns no formatting
  // at all. No crawl happens — this is the same run, written differently.
  if (url.pathname === '/render' && request.method === 'POST') {
    const asked = url.searchParams.get('as') ?? 'html';
    const writers = {
      html: { render: htmlReport, type: 'text/html; charset=utf-8' },
      markdown: { render: markdownReport, type: 'text/markdown; charset=utf-8' },
      csv: { render: csvReport, type: 'text/csv; charset=utf-8' },
    };
    const writer = writers[asked];
    if (!writer) {
      return new Response(`Unknown format "${asked}". Try: ${Object.keys(writers).join(', ')}, json.`, {
        status: 400,
      });
    }
    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response('That body is not JSON.', { status: 400 });
    }
    if (!Array.isArray(payload?.findings) || !payload?.meta) {
      return new Response('Expected { meta, findings }.', { status: 400 });
    }
    // The score travels with the payload rather than being recomputed here:
    // this route never crawls, so it has no way to know what applied.
    return new Response(writer.render(payload.findings, payload.meta, { score: payload.score }), {
      headers: { 'content-type': writer.type },
    });
  }

  if (url.pathname === '/stream') {
    const target = targetFor(url.searchParams.get('url'), env);
    if (target.error) return new Response(target.error, { status: 400 });

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    // JSON, so a URL containing a newline cannot end an event early and inject
    // one of its own.
    const send = (event, data) =>
      writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

    const origin = new URL(target.url).origin;
    const work = (async () => {
      try {
        const { findings, meta, sitemap, llms, schema, score } = await run(target.url, {
          limit: pageLimit(url.searchParams.get('limit'), env),
          concurrency: crawlConcurrency(url.searchParams.get('concurrency'), env),
          checkExternal: url.searchParams.get('external') === '1',
          // The corrected sitemap travels with the report, because rebuilding
          // it needs per-page data a client is never sent. Costs one cached
          // request; everything else it reads is already in memory.
          writeSitemap: url.searchParams.get('sitemap-out') === '1',
          // Same arrangement: built during the run because it needs each page's
          // title, description and canonical, none of which survives the crawl.
          writeLlms: url.searchParams.get('llms-out') === '1',
          writeSchema: url.searchParams.get('schema-out') === '1',
          // Checks the run was told to silence. Only ever removes findings, so
          // it needs no gate — and meta.ignored still reports how many, because
          // a silenced check that says nothing is indistinguishable from one
          // that passed.
          ignore: idList(url.searchParams.get('ignore')),
          ...psiOptions(url.searchParams, env),
          ...searchConsoleProperty(url.searchParams, env),
          sitemap: sitemapOverride(url.searchParams.get('sitemap'), target.url),
          userAgent: agentFor(url.searchParams, env),
          // Off where there is no socket to read a certificate over, and only
          // there. This module runs in two places: Cloudflare, which cannot,
          // and `--serve` under Node, which can — and the macOS window is the
          // second one. It used to be switched off for both, so the app skipped
          // a check it was perfectly able to run and then told people the
          // report "was produced by the hosted version", which it was not.
          ...(canReadCertificates(env) ? {} : { readCertificateExpiry: async () => null }),
          onProgress: (event) => send('progress', progressText(event, origin)),
          onNote: (note) => send('progress', `note       ${note}`),
        });
        const all = canReadCertificates(env)
          ? findings
          : [...findings, { ...NO_CERTIFICATE_CHECK, url: meta.origin }];

        // The note is appended after the audit returned, so the score that came
        // with it still counts the two certificate checks as applicable. Scored
        // again here, with the same function, rather than left describing a
        // checklist this runtime did not run — a hosted report and a CLI report
        // must be the same document or neither is trustworthy.
        const scored = canReadCertificates(env)
          ? score
          : scoreRun(all, { pages: meta.pages, applicable: { ...meta.applicable, tls: false } });

        // A native client wants the findings, not a page. The grouping travels
        // with them, from the same causePayload() the CLI's --json calls, so
        // that a report from here and a report from the command line are the
        // same document.
        const payload = {
          meta,
          findings: all,
          causes: causePayload(all, meta.pages),
          score: scored,
          ...(sitemap ? { sitemap } : {}),
          ...(llms ? { llms } : {}),
          ...(schema ? { schema } : {}),
        };

        // Kept where there is somewhere to keep it — the local server hands one
        // over, a deployed Worker does not. A seven-minute crawl should only
        // ever happen once, and that is not a macOS-only claim.
        const kept = env.STORE?.keep?.(payload, { site: target.url }) ?? null;

        if (url.searchParams.get('format') === 'json') {
          await send('done', payload);
        } else {
          // The report replaces this page entirely, so it has to carry its own
          // way back to the form — otherwise the only route is the browser's
          // back button, onto a page that has finished streaming and shows a
          // stale log.
          // Into the window rather than over it: the report replaces the
          // document, so without the shell the sidebar would vanish the moment
          // a crawl finished — which is the one moment somebody wants to click
          // back to what they ran before.
          const parts = reportParts(all, meta, { score: scored });
          await send('done', env.STORE && kept
            ? shell(parts.title, `<main>${exportBar(kept.id)}${parts.body}</main>`, env, {
                currentId: kept.id,
              })
            : render(all, meta, { backHref: '/', backLabel: 'Audit another site', score: scored }));
        }
      } catch (err) {
        await send('failed', `The audit stopped: ${err.message}`);
      } finally {
        await writer.close();
      }
    })();
    // Keep the isolate alive for the crawl even if the browser goes away mid-run,
    // so the request that started it is what pays for it rather than a retry.
    ctx?.waitUntil?.(work);

    return new Response(readable, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        // Nothing between here and the browser should hold the log back
        // waiting for a buffer to fill.
        'x-accel-buffering': 'no',
      },
    });
  }

  return htmlResponse(page('Not found', '<h1>Not found</h1><p class="sub"><a href="/">Back to the form</a></p>'), 404);
}

const unlockPage = (message = '', status = 401) =>
  htmlResponse(
    page('Password', `
      <h1>Password</h1>
      <p class="sub">${message ? esc(message) : 'This deployment is not open to the internet.'}</p>
      <form action="/unlock" method="post">
        <label for="token">AUDIT_TOKEN</label>
        <input id="token" name="token" type="password" required autofocus>
        <button type="submit">Unlock</button>
      </form>`),
    status,
  );

export default { fetch: (request, env, ctx) => handle(request, env, ctx) };
