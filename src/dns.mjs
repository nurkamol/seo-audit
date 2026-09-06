// DNS, asked over HTTPS, because that is the only resolver every runtime this
// engine runs in actually has.
//
// `node:dns` is the obvious choice and it is the wrong one. The Workers runtime
// has no such module, so anything built on it would quietly vanish from every
// hosted report — and a missing finding reads exactly like a passing one, which
// is the failure this project exists to refuse. `tls-expiring` already pays
// that price and has to apologise for it in the report with `tls-not-checked`.
// DNS does not have to: DoH is a `fetch` and a JSON body, so the CLI, the
// Worker and both desktop shells ask the same resolver the same question.
//
// Cloudflare's resolver rather than Google's, and not as a preference:
// dns.google refused a plain fetch outright while cloudflare-dns.com answered
// the same query, and a lookup that works everywhere beats one that works in a
// datacentre. `resolver` is a parameter so a network that blocks it can point
// somewhere else, and so the tests never touch the internet.

/** Cloudflare's DoH endpoint, in its JSON dialect. */
export const RESOLVER = 'https://cloudflare-dns.com/dns-query';

/** The certificate transparency searches this asks, in the order it asks them.
 *
 *  Ordered by measured reliability, not by preference. crt.sh is the one
 *  everybody names and it is not dependable enough to be the only one: asked
 *  five times in forty seconds it answered twice — one 502, two successes at
 *  6.9s and 20.9s, and two timeouts at thirty. certspotter answered the same
 *  question in 1.8 seconds. Both are free and neither needs a key, so there is
 *  no reason to depend on one.
 *
 *  First answer wins rather than merging the two. The names feed a sweep that
 *  is capped at forty anyway, so a second source would double the latency to
 *  refine a list that gets truncated — and the whole point of the ordering is
 *  that the fast one usually answers.
 */
export const CERTIFICATE_SOURCES = [
  {
    name: 'certspotter',
    url: (domain) =>
      'https://api.certspotter.com/v1/issuances' +
      `?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names`,
    // One issuance, many names, already an array.
    names: (rows) => (Array.isArray(rows) ? rows.flatMap((row) => row?.dns_names ?? []) : null),
  },
  {
    name: 'crt.sh',
    url: (domain) => `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`,
    // One certificate covers many names, and crt.sh packs them into one
    // newline-separated string rather than an array.
    names: (rows) =>
      Array.isArray(rows) ? rows.flatMap((row) => String(row?.name_value ?? '').split('\n')) : null,
  },
];

/** One source, asked. `null` means it did not answer. */
async function askLog(source, domain, { timeout, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(source.url(domain), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return source.names(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The record types this asks for, by their wire numbers, because that is what
 *  a DoH answer is labelled with. */
const TYPE = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };

/** NXDOMAIN. The one DNS response code this file treats as load-bearing: it is
 *  the difference between "that name is not there" and "I could not tell you",
 *  and a dangling-CNAME finding that confused the two would be a false positive
 *  aimed at somebody's live site. */
export const NXDOMAIN = 3;

/**
 * One DNS question, answered or honestly not.
 *
 * `ok: false` means the lookup did not happen — the resolver was unreachable,
 * slow, or answered something that was not JSON. It is deliberately distinct
 * from an empty `records`, which means the resolver answered and there is
 * nothing there. Callers must not read the second as the first.
 *
 * @returns {Promise<{ok: boolean, status: number|null, records: string[], cname: string[]}>}
 */
export async function resolve(name, type, opts = {}) {
  const { resolver = RESOLVER, timeout = 5000, fetchImpl = fetch } = opts;
  const empty = { ok: false, status: null, records: [], cname: [] };
  if (!TYPE[type]) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(`${resolver}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: controller.signal,
    });
    if (!res.ok) return empty;
    const body = await res.json();
    const answers = Array.isArray(body?.Answer) ? body.Answer : [];
    // A trailing dot is how DNS writes a fully qualified name and is noise
    // everywhere else in this codebase, so it comes off here rather than at
    // each of the six places that would otherwise have to remember.
    const data = (rrType) =>
      answers.filter((a) => a.type === rrType).map((a) => String(a.data ?? '').replace(/\.$/, ''));
    return {
      ok: true,
      status: typeof body?.Status === 'number' ? body.Status : null,
      records: data(TYPE[type]),
      // Asking for A on a name that is an alias answers with the CNAME *and*
      // the addresses it resolves through to. Both are worth having and one
      // question is cheaper than two, so the alias is always carried back.
      cname: data(TYPE.CNAME),
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every hostname certificate transparency has ever seen for a domain, and which
 * log said so.
 *
 * `null` means no source answered, which is not the same as a domain with no
 * certificates and must never be reported as one. That is not a rare branch:
 * crt.sh alone failed three times in five in testing, which is the reason there
 * is more than one source here.
 *
 * The source is carried back because the report says which log answered. Two
 * runs of one domain can legitimately list different hosts if different logs
 * answered them, and a reader comparing those two runs is owed the reason.
 *
 * @returns {Promise<{source: string, names: string[]}|null>}
 */
export async function certificateNames(domain, opts = {}) {
  const { sources = CERTIFICATE_SOURCES, timeout = 25000, fetchImpl = fetch } = opts;

  for (const source of sources) {
    const raw = await askLog(source, domain, { timeout, fetchImpl });
    if (!raw) continue;

    const names = new Set();
    for (const entry of raw) {
      const name = String(entry ?? '').trim().toLowerCase().replace(/\.$/, '');
      // A wildcard is not a host. `*.example.com` says a certificate covers any
      // name at that level, not that any particular one exists, and resolving
      // it asks a question with no answer.
      if (!name || name.startsWith('*')) continue;
      if (name === domain || name.endsWith(`.${domain}`)) names.add(name);
    }
    return { source: source.name, names: [...names] };
  }
  return null;
}

/** Hostnames that are a fleet rather than a service, collapsed.
 *
 *  Certificate transparency is a log of every certificate ever issued, which
 *  makes it the best free source of hostnames and a terrible list of live ones.
 *  cloudflare.com's log holds 3,425 distinct names and roughly three thousand
 *  of them are `ssl2081.cloudflare.com` and its numbered siblings, none of
 *  which have existed for years.
 *
 *  So names are grouped by *shape* — every run of digits becomes `#` — and at
 *  most `perShape` survive each one. That empties the fleet without a
 *  hand-written blocklist of somebody's naming convention, and it keeps
 *  `staging.` and `staging2.` because those are two shapes and both are worth
 *  a look, while `ssl2081.` and three thousand others become two. */
export function collapseFleets(names, { perShape = 2 } = {}) {
  const seen = new Map();
  const out = [];
  for (const name of names) {
    const shape = name.replace(/\d+/g, '#');
    const count = seen.get(shape) ?? 0;
    if (count >= perShape) continue;
    seen.set(shape, count + 1);
    out.push(name);
  }
  return out;
}

/** The leftmost labels that mean "this was never meant to be public".
 *
 *  Kept deliberately tight. `beta.` and `demo.` are missing on purpose: plenty
 *  of companies run both as products, and a check that reports somebody's
 *  shipped beta as a leak is the kind of false positive that gets a whole
 *  report closed. Everything here names an environment, not a product. */
export const STAGING_LABEL =
  /^(staging|stage|staging-\w+|dev|develop|development|test|testing|tst|uat|qa|preview|sandbox|wip|scratch)\d*$/;

/** Whether a hostname's leftmost label names a non-production environment. */
export const looksLikeStaging = (host) => STAGING_LABEL.test(host.split('.')[0]);

/** Candidates worth spending a lookup on, best first.
 *
 *  There is a cap, so the order is the difference between finding a leaked
 *  staging host and finding two hundred names beginning with `a`. Environment
 *  names first because they are what the checks are for; then the short names,
 *  because a service a company runs on purpose is usually called something
 *  short, and the long ones are usually machines. */
export function rankHosts(names, apex) {
  const depth = (n) => n.split('.').length;
  const score = (n) => (looksLikeStaging(n) ? 0 : 1);
  return [...names]
    .filter((n) => n !== apex && n !== `www.${apex}`)
    .sort((a, b) => score(a) - score(b) || depth(a) - depth(b) || a.length - b.length || a.localeCompare(b));
}
