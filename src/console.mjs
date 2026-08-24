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

/** Impressions and clicks per page for the last 28 days.
 *
 *  Search Console reports the last three days incompletely, so the window ends
 *  three days back: a page that looks like it lost all its impressions
 *  yesterday has usually just not been counted yet. */
export async function pageTraffic(siteUrl, creds, { fetcher = fetch, now = Date.now(), rowLimit = 25000 } = {}) {
  const token = await accessToken(creds, fetcher);
  const res = await fetcher(`${API}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      startDate: isoDaysAgo(31, now),
      endDate: isoDaysAgo(3, now),
      dimensions: ['page'],
      rowLimit,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message ?? `HTTP ${res.status} from Search Console`);
  }
  const traffic = new Map();
  for (const row of data.rows ?? []) {
    const page = row.keys?.[0];
    if (!page) continue;
    traffic.set(page.replace(/\/$/, ''), {
      impressions: Math.round(row.impressions ?? 0),
      clicks: Math.round(row.clicks ?? 0),
    });
  }
  return traffic;
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

  let matched = 0;
  for (const finding of findings) {
    if (!finding.url) continue;
    const seen = traffic.get(finding.url.replace(/\/$/, ''));
    if (!seen) continue;
    finding.traffic = seen;
    matched++;
  }

  const shown = [...traffic.values()].reduce((n, t) => n + t.impressions, 0);
  return [
    f('info', 'search-console', `Search Console has ${traffic.size.toLocaleString()} pages for this site`,
      `${matched.toLocaleString()} of this crawl's findings are on pages Google has shown, ` +
        `${shown.toLocaleString()} times between them over 28 days. Findings are ordered by that where it ` +
        'is known, and by how much of the site links to a page where it is not.', origin),
  ];
}
