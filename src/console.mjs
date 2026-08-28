// Search Console: what the pages in this crawl actually do in Google.
//
// Every ordering in this report so far is derived from the site's own markup —
// how many links point at a page, how far it is from the homepage. Those are
// good proxies. Impressions are not a proxy: a broken canonical on a page with
// four thousand impressions a month is a different sentence from the same
// canonical on a page nobody has ever been shown.
//
// Opt-in, and the only thing in this tool that needs an account. Credentials
// are read the way the PageSpeed key is — the environment first, then
// ~/.config/seo-audit/.env — and never from the repository.
import { readSecret } from './config.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://searchconsole.googleapis.com/webmasters/v3/sites';

const f = (level, id, title, detail, url) => ({ level, id, title, detail, url });

/** One credential, environment first. The loader is shared with the PageSpeed
 *  key: this file had its own copy, and its copy could not read the dotfile at
 *  all. */
export const findCredential = readSecret;

/** All three, or a sentence saying which is missing. */
export function credentials(env = process.env) {
  const found = {
    clientId: findCredential('GSC_CLIENT_ID', env),
    clientSecret: findCredential('GSC_CLIENT_SECRET', env),
    refreshToken: findCredential('GSC_REFRESH_TOKEN', env),
  };
  const missing = Object.entries({
    GSC_CLIENT_ID: found.clientId,
    GSC_CLIENT_SECRET: found.clientSecret,
    GSC_REFRESH_TOKEN: found.refreshToken,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return missing.length ? { missing } : found;
}

/** A refresh token is the long-lived half; this trades it for the short one. */
async function accessToken({ clientId, clientSecret, refreshToken }, fetcher = fetch) {
  const res = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? `HTTP ${res.status} from Google's token endpoint`);
  }
  return data.access_token;
}

const isoDaysAgo = (days, now) => new Date(now - days * 86400000).toISOString().slice(0, 10);

/** One `searchAnalytics/query` call. The window is the same for every caller.
 *
 *  Search Console reports the last three days incompletely, so it ends three
 *  days back: a page that looks like it lost all its impressions yesterday has
 *  usually just not been counted yet. */
async function query(siteUrl, token, { dimensions, rowLimit, now, fetcher }) {
  const res = await fetcher(`${API}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      startDate: isoDaysAgo(31, now),
      endDate: isoDaysAgo(3, now),
      dimensions,
      rowLimit,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message ?? `HTTP ${res.status} from Search Console`);
  }
  return data.rows ?? [];
}

/** A URL as it is compared, here and in the crawl: no trailing slash. */
const same = (url) => String(url ?? '').replace(/\/$/, '');

/** Impressions, clicks and average position per page for the last 28 days.
 *
 *  `position` was in every response Google has ever sent and was being thrown
 *  away. It is the one number in this tool that is a *ranking* rather than a
 *  fault, and it is measured rather than estimated — which is the only reason
 *  it is allowed anywhere near this project. Rounded to a tenth: an average
 *  position is a mean over impressions and its second decimal is noise. */
export async function pageTraffic(siteUrl, creds, { fetcher = fetch, now = Date.now(), rowLimit = 25000 } = {}) {
  const token = await accessToken(creds, fetcher);
  const rows = await query(siteUrl, token, { dimensions: ['page'], rowLimit, now, fetcher });

  const traffic = new Map();
  for (const row of rows) {
    const page = row.keys?.[0];
    if (!page) continue;
    traffic.set(same(page), {
      impressions: Math.round(row.impressions ?? 0),
      clicks: Math.round(row.clicks ?? 0),
      // Absent rather than zero when Google did not send one: position 0 does
      // not exist, and a page "ranking 0" would sort ahead of every real one.
      ...(typeof row.position === 'number' ? { position: Math.round(row.position * 10) / 10 } : {}),
    });
  }
  return traffic;
}

/** The queries each page is actually found for, best-placed first.
 *
 *  A rank checker that needs no scraping and no second account: these are the
 *  searches Google has already shown this site for, from the property whose
 *  owner is running the audit. Nothing here asks what a page "should" rank for,
 *  which is the part every keyword tool invents.
 *
 *  `perPage` is small on purpose. The point is to name what a page is found
 *  for, not to export the property — a full query export is Search Console's
 *  own job and it is better at it. */
export async function pageQueries(
  siteUrl,
  creds,
  { fetcher = fetch, now = Date.now(), rowLimit = 5000, perPage = 5 } = {},
) {
  const token = await accessToken(creds, fetcher);
  const rows = await query(siteUrl, token, { dimensions: ['page', 'query'], rowLimit, now, fetcher });

  const byPage = new Map();
  for (const row of rows) {
    const [page, term] = row.keys ?? [];
    if (!page || !term) continue;
    const list = byPage.get(same(page)) ?? [];
    list.push({
      query: term,
      impressions: Math.round(row.impressions ?? 0),
      clicks: Math.round(row.clicks ?? 0),
      position: typeof row.position === 'number' ? Math.round(row.position * 10) / 10 : null,
    });
    byPage.set(same(page), list);
  }

  // Most-shown first within a page, then cut. Sorted here rather than trusted
  // from the response: Google orders by clicks, and a query with impressions
  // and no clicks is exactly the one worth naming.
  for (const [page, list] of byPage) {
    byPage.set(page, list.sort((a, b) => b.impressions - a.impressions).slice(0, perPage));
  }
  return byPage;
}

/** Pages that rank, just not where anybody sees them.
 *
 *  Positions 11 to 20 are page two of Google, where the click-through rate is
 *  roughly nothing and the ranking is already earned. This is the only list in
 *  this tool that is an opportunity rather than a fault, and every number in it
 *  was measured by Google rather than worked out here.
 *
 *  Deliberately bounded below by impressions: a page at 13.0 that was shown
 *  twice is noise, and naming it would make the list unreadable. */
export function strikingDistance(traffic, queries, { from = 10.5, to = 20.5, minImpressions = 10 } = {}) {
  const out = [];
  for (const [page, seen] of traffic) {
    if (typeof seen.position !== 'number') continue;
    if (seen.position < from || seen.position > to) continue;
    if (seen.impressions < minImpressions) continue;
    // The query this page is closest on — the one worth looking at first.
    const best = (queries?.get(page) ?? [])
      .filter((row) => typeof row.position === 'number')
      .sort((a, b) => a.position - b.position)[0] ?? null;
    out.push({ page, ...seen, best });
  }
  return out.sort((a, b) => b.impressions - a.impressions);
}

/** Attach traffic to findings, and say what was found.
 *
 *  A property Search Console does not have, or credentials it will not accept,
 *  is reported as a note rather than thrown: the rest of the audit is still
 *  worth having, and an audit that dies because an optional integration failed
 *  is worse than one that says so. */
export async function searchConsole(origin, findings, opts = {}) {
  const creds = opts.credentials ?? credentials();
  if (creds.missing) {
    return [
      f('info', 'search-console-unconfigured', 'Search Console was asked for but not configured',
        `Missing ${creds.missing.join(', ')}. Set them in the environment or in ` +
          '~/.config/seo-audit/.env — never in the repository. Without them the report is ordered by ' +
          'how much of the site links to a page, which is a proxy for the same thing.', origin),
    ];
  }

  let traffic;
  try {
    traffic = await pageTraffic(opts.siteUrl ?? `${origin}/`, creds, opts);
  } catch (err) {
    return [
      f('info', 'search-console-failed', 'Search Console did not answer',
        `${err.message}. The property has to be one this account can read, and a domain property is ` +
          'named "sc-domain:example.com" rather than by its URL. Everything else in this report is ' +
          'unaffected.', origin),
    ];
  }

  // The queries are a second call and a best-effort one: without them the
  // positions still stand, and an optional integration's optional half must not
  // be able to take the useful half down with it.
  let queries = null;
  let queriesFailed = false;
  try {
    queries = await pageQueries(opts.siteUrl ?? `${origin}/`, creds, opts);
  } catch {
    queriesFailed = true;
  }

  let matched = 0;
  for (const finding of findings) {
    if (!finding.url) continue;
    const seen = traffic.get(same(finding.url));
    if (!seen) continue;
    // The page's own numbers, and nothing more. The queries are deliberately
    // not attached here: they are the same five strings on every finding of a
    // page, and a 300-page site's JSON report would carry them two thousand
    // times over.
    finding.traffic = seen;
    matched++;
  }

  // Impressions on the pages this crawl actually reached, counted once per
  // page. The first live run summed every row in the property instead — the
  // report said one finding had been "shown 98 times between them" when its
  // page had 13, because the other 85 were on pages the crawl never touched.
  // Both numbers are worth having; they are two different sentences.
  const counted = new Set();
  let shown = 0;
  for (const finding of findings) {
    if (!finding.traffic || counted.has(finding.url)) continue;
    counted.add(finding.url);
    shown += finding.traffic.impressions;
  }
  const everywhere = [...traffic.values()].reduce((n, t) => n + t.impressions, 0);

  // Averaged over the crawled pages Google actually ranks, and weighted by
  // impressions — a page shown four thousand times and one shown twice are not
  // two equal opinions about where this site sits.
  const ranked = [...counted]
    .map((url) => traffic.get(same(url)))
    .filter((seen) => seen && typeof seen.position === 'number');
  const weight = ranked.reduce((n, seen) => n + Math.max(1, seen.impressions), 0);
  const average = weight
    ? ranked.reduce((n, seen) => n + seen.position * Math.max(1, seen.impressions), 0) / weight
    : 0;

  // Pages that already rank, just below where anybody looks. Bounded to the
  // pages this crawl actually reached: a list of page-twos on URLs the run
  // never opened is a list nobody can act on from this report.
  const crawled = new Set(findings.map((finding) => same(finding.url)).filter(Boolean));
  const striking = strikingDistance(traffic, queries).filter((row) => crawled.has(row.page));

  const notes = [];
  if (striking.length) {
    const shownRows = striking.slice(0, 8).map((row) => {
      const term = row.best ? `, best on "${row.best.query}" at ${row.best.position}` : '';
      return `${row.page} (position ${row.position}, ${row.impressions.toLocaleString()} impressions${term})`;
    });
    notes.push(
      f('info', 'search-console-striking',
        `${striking.length} crawled page${striking.length === 1 ? '' : 's'} rank just below page one`,
        `${shownRows.join('; ')}${striking.length > 8 ? `, and ${striking.length - 8} more` : ''}. ` +
          'Positions 11 to 20 over 28 days, most-shown first. These already rank for something and ' +
          'almost nobody sees them, so moving one up two places is usually less work than a new page. ' +
          'Every number here was measured by Google, not worked out here.',
        striking[0].page),
    );
  }

  return [
    ...notes,
    f('info', 'search-console', `Search Console has ${traffic.size.toLocaleString()} pages for this site`,
      `${matched.toLocaleString()} of this crawl's findings ${matched === 1 ? 'is' : 'are'} on ` +
        `${counted.size.toLocaleString()} page${counted.size === 1 ? '' : 's'} Google has shown, ` +
        `${shown.toLocaleString()} time${shown === 1 ? '' : 's'} over 28 days — out of ` +
        `${everywhere.toLocaleString()} across the whole property. Findings are ordered by that where it ` +
        'is known, and by how much of the site links to a page where it is not.' +
        (ranked.length
          ? ` Average position across the ${ranked.length.toLocaleString()} crawled page` +
            `${ranked.length === 1 ? '' : 's'} Google ranks: ${average.toFixed(1)}.`
          : '') +
        // A half that did not run reads exactly like a half that found nothing,
        // which is the failure this project spends most of its effort avoiding.
        // Verified against a live property: a site with 99 impressions over 28
        // days gets HTTP 200 and zero rows for `query`, because Google withholds
        // queries below a privacy threshold. Saying so is the difference between
        // "no keywords" and "the tool is broken".
        (queriesFailed
          ? ' The queries for these pages could not be read; the positions above are unaffected.'
          : traffic.size && queries && queries.size === 0
            ? ' Google returned no queries for this property: it withholds any search too rare to be ' +
              'anonymous, and a site at this traffic is usually under that threshold. The positions ' +
              'above are unaffected.'
            : ''), origin),
  ];
}

// --- Getting a refresh token ------------------------------------------------
//
// The three variables above were documented for a year and there was never a
// way to obtain the third one. That is why `--search-console` has never run
// against the live API: not the code, the paperwork in front of it.
//
// Loopback OAuth, which is what Google's own docs call the installed-app flow.
// A desktop client may redirect to any port on 127.0.0.1 without registering
// it, so this listens on an ephemeral one, and the browser does the signing in.
// The token is written to the same file the key lives in and is never printed:
// a refresh token in a terminal is a refresh token in a scrollback buffer.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export const DOTFILE = join(homedir(), '.config', 'seo-audit', '.env');

/** Where the browser is sent. `prompt=consent` is not politeness: without it
 *  Google returns no refresh token at all on a second authorisation, which is
 *  the confusing half of this flow. Read-only scope, because this only ever
 *  reads. */
export function authUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/** The code the browser came back with, traded for the long-lived half. */
export async function exchangeCode({ clientId, clientSecret, code, redirectUri }, fetcher = fetch) {
  const res = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) {
    throw new Error(
      data.error_description ??
        data.error ??
        'Google returned no refresh token. This happens when the account has authorised this ' +
          'client before — revoke it at myaccount.google.com/permissions and try again.',
    );
  }
  return data;
}

/** What this account can actually read. Printed after a login because a token
 *  that works for nothing looks exactly like a token that works. */
export async function listProperties(token, fetcher = fetch) {
  const res = await fetcher(API, { headers: { authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status} listing properties`);
  return (data.siteEntry ?? []).map((s) => ({ url: s.siteUrl, permission: s.permissionLevel }));
}

/** One line rewritten, the rest of the file untouched.
 *
 *  Kept pure and exported so it can be tested: this writes to the file holding
 *  somebody's PageSpeed key, and clobbering that to save a Search Console token
 *  would be a poor trade. */
export function upsertSecret(text, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^\\s*${name}\\s*=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  return text.length && !text.endsWith('\n') ? `${text}\n${line}\n` : `${text}${line}\n`;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

const donePage = (heading, body) =>
  `<!doctype html><meta charset="utf-8"><title>${heading}</title>` +
  '<style>body{font:16px/1.6 -apple-system,system-ui,sans-serif;margin:20vh auto;max-width:32rem;' +
  'padding:0 1.5rem;color:#111}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#555;margin:0}' +
  '@media(prefers-color-scheme:dark){body{background:#111;color:#eee}p{color:#aaa}}</style>' +
  `<h1>${heading}</h1><p>${body}</p>`;

/**
 * Sign in once, and write the refresh token where the audit will look for it.
 *
 * Interactive by nature, which is why it is not an Action input: a flag CI can
 * accept and never satisfy is worse than no flag. The pieces that can be wrong
 * quietly — the authorisation URL, the token exchange, rewriting a file that
 * already holds somebody's PageSpeed key — are separate exported functions with
 * tests. What is left here is a socket and a browser.
 */
export async function login({
  fetcher = fetch,
  openUrl = openBrowser,
  onNote = () => {},
  dotfile = DOTFILE,
  timeout = 300_000,
  // Injectable for the same reason the certificate reader is: otherwise the
  // only way to exercise this is to have real credentials on the machine, and
  // a test that needs those is a test nobody runs.
  client,
} = {}) {
  const clientId = client?.clientId ?? readSecret('GSC_CLIENT_ID');
  const clientSecret = client?.clientSecret ?? readSecret('GSC_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error(
      'No OAuth client yet. In console.cloud.google.com: enable the Search Console API, then ' +
        'create an OAuth client of type "Desktop app". Put its two values in ' +
        `${dotfile} as GSC_CLIENT_ID and GSC_CLIENT_SECRET, and run this again.`,
    );
  }

  const state = randomBytes(16).toString('hex');
  const server = createServer();
  // Port 0: a desktop client may redirect to any port on the loopback address
  // without registering it, so nothing here has to be configured or be free.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Nothing came back within ${Math.round(timeout / 1000)}s. Nothing was written.`)),
      timeout,
    );
    server.on('request', (req, res) => {
      const asked = new URL(req.url, redirectUri);
      if (asked.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const returned = asked.searchParams.get('code');
      const failed = asked.searchParams.get('error');
      // The state is the only thing standing between this and a page on the
      // internet quietly posting a code to a port on the machine.
      const mismatched = asked.searchParams.get('state') !== state;
      res.writeHead(failed || !returned || mismatched ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
      if (failed || !returned || mismatched) {
        res.end(donePage('That did not work', 'Nothing was written. The terminal has the detail.'));
        clearTimeout(timer);
        reject(new Error(mismatched ? 'The reply did not match the request this started.' : (failed ?? 'No code came back.')));
        return;
      }
      res.end(donePage('Signed in', 'You can close this tab and go back to the terminal.'));
      clearTimeout(timer);
      resolve(returned);
    });

    const url = authUrl({ clientId, redirectUri, state });
    onNote(openUrl(url) ? `waiting on ${redirectUri}` : `open this and sign in:\n\n  ${url}\n`);
  }).finally(() => server.close());

  const granted = await exchangeCode({ clientId, clientSecret, code, redirectUri }, fetcher);

  mkdirSync(dirname(dotfile), { recursive: true });
  const existing = existsSync(dotfile) ? readFileSync(dotfile, 'utf8') : '';
  // 0600, and never printed: a refresh token echoed to a terminal is a refresh
  // token in a scrollback buffer and probably in a shell history file.
  writeFileSync(dotfile, upsertSecret(existing, 'GSC_REFRESH_TOKEN', granted.refresh_token), { mode: 0o600 });

  // A token that can read nothing looks exactly like a token that works, until
  // an audit says the property was not found.
  return { dotfile, properties: await listProperties(granted.access_token, fetcher) };
}
