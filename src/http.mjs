// Fetching, with the two things a crawler actually needs: a concurrency limit
// so a small site is not hammered, and a cache so the same URL is never
// fetched twice across checks.

const DEFAULT_UA = 'seo-audit (+https://github.com/nurkamol/seo-audit)';

/** Whether a response is bot protection answering instead of the page.
 *
 *  `'challenge'` is an interstitial asking the client to prove it is a browser;
 *  `'denied'` is a flat refusal. Either way nothing about the page was read,
 *  and reporting it as a page that failed to load would say the site is broken
 *  when every visitor and Google are being served it normally — the worst kind
 *  of false positive, because it looks exactly like the real thing.
 *
 *  Only on evidence. `cf-mitigated: challenge` is Cloudflare's documented
 *  marker on every challenge it serves. Without it, a 403 or 503 has to carry
 *  a challenge page's own words, because a site's genuine 403 is a real
 *  finding. A 200 is never classified from its body: Cloudflare injects
 *  `/cdn-cgi/challenge-platform/` scripts into ordinary pages on sites running
 *  bot detection, and treating those as challenges would skip real pages.
 *
 *  430 is Shopify's documented "Security Rejection". */
export function blockedBy(status, headers, body = '') {
  if ((headers?.get?.('cf-mitigated') ?? '').toLowerCase() === 'challenge') return 'challenge';
  if (status === 430) return 'denied';
  if (status !== 403 && status !== 503) return null;
  const text = String(body).slice(0, 50000);
  if (/your connection needs to be verified|<title>\s*just a moment|\/cdn-cgi\/challenge-platform\/|checking your browser/i.test(text)) {
    return 'challenge';
  }
  if (/sorry, you have been blocked/i.test(text)) return 'denied';
  if (/cloudflare/i.test(headers?.get?.('server') ?? '') && /<title>\s*access denied\s*<\/title>/i.test(text)) {
    return 'denied';
  }
  return null;
}

/** Whether `url` is on `origin` exactly — scheme, host and port. */
const sameOrigin = (url, origin) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

/** A response asking the crawl to slow down: 429, or a 503 that says when to
 *  come back. A 503 without Retry-After is an outage and stays one. */
export const throttled = (res) =>
  res.status === 429 || (res.status === 503 && Boolean(res.headers?.get?.('retry-after')));

/** Seconds to wait after a refusal.
 *
 *  Retry-After is a **minimum**, not a promise. Shopify sends 60 and a request
 *  made at 75 can still be refused, so a refusal that follows a wait doubles
 *  the next one. The cap is five minutes, past which a store is asking for a
 *  different tool. Without the header, 2, 4, then 8 seconds: the concurrency
 *  coming down does most of the work there. */
export function waitFor(retryAfter, inARow) {
  const asked = Number.parseInt(retryAfter ?? '', 10);
  const n = Math.max(1, inARow);
  return Number.isFinite(asked) && asked > 0
    ? Math.min(asked * 2 ** (n - 1), 300)
    : Math.min(2 ** n, 8);
}

/** Consecutive refusals from one host before the crawl stops asking it. Four,
 *  with Shopify's 60 doubling, is about twelve minutes of being told no — long
 *  enough to outlast a burst, short enough that the run ends with what it has
 *  instead of timing out with nothing. */
const GIVE_UP_AFTER = 4;

export class Fetcher {
  /** @param {{concurrency?: number, timeout?: number}} opts */
  constructor({ concurrency = 6, timeout = 20000, userAgent = DEFAULT_UA, onWait, onPace, sleep } = {}) {
    this.timeout = timeout;
    this.userAgent = userAgent;
    /** Told when the crawl pauses, so a front end can say why it went quiet
     *  rather than look frozen for a minute. */
    this.onWait = onWait;
    /** Told when the crawl slows itself down for a platform it recognised. */
    this.onPace = onPace;
    /** How a pause is spent. Replaceable so a test can exercise a five-minute
     *  back-off without waiting five minutes for it. */
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    /** Milliseconds between request starts, once a host has shown it wants
     *  them spaced. Zero until then. Concurrency alone does not space anything:
     *  one request at a time, back to back, is still a burst to a strict host. */
    this.interval = 0;
    this.nextStart = 0;
    /** Refusals in a row, and the hosts the crawl has stopped asking. */
    this.refusedInARow = 0;
    this.givenUp = new Set();
    /** Set when a response identifies the platform, e.g. `'shopify'`. */
    this.platform = null;
    /** The store's permission for this crawl — `{ origin, headers }` — or null.
     *  See signature.mjs. */
    this.signed = null;
    /** Consecutive timeouts. Some hosts accept the TLS handshake and then
     *  never answer — Cloudflare's bot management does this to clients whose
     *  TLS fingerprint is not a browser. Retrying that is 20 seconds of
     *  nothing, per attempt, per URL. */
    this.timeouts = 0;
    this.reachable = false;
    /** Set when a host answers 429. Nothing starts before it, and the
     *  concurrency comes down with it — retrying a rate limit at the speed
     *  that caused it just spends the budget again. */
    this.quietUntil = 0;
    this.rateLimited = 0;
    this.cache = new Map();
    this.queue = [];
    this.active = 0;
    this.concurrency = concurrency;
    this.count = 0;
  }

  /** Send a crawler signature with every request to `origin`, and to nothing
   *  else. A signature is a credential the store made for its own domain:
   *  handing it to an outbound link, a CDN or another host would give it to
   *  somebody it was not made for. Calling it again moves it, which is how it
   *  follows a redirect from the bare domain to `www.`. */
  sign(signature) {
    this.signed = signature?.headers ? { origin: new URL(signature.origin).origin, headers: signature.headers } : null;
  }

  /** Wait out a rate limit, if one is in force. */
  async #quiet() {
    const wait = this.quietUntil - Date.now();
    if (wait > 0) await this.sleep(wait);
  }

  /** Space request starts, once a host has asked for that. Each caller takes
   *  the next free slot, so retries that were all waiting on the same pause do
   *  not leave it together — which is what used to happen: six requests in
   *  flight sat out the pause, retried at once, were refused at once, and
   *  spent their attempts in a single second. */
  async #pace() {
    if (!this.interval) return;
    const now = Date.now();
    const at = Math.max(now, this.nextStart);
    this.nextStart = at + this.interval;
    if (at > now) await this.sleep(at - now);
  }

  /** A refusal is the server asking for a slower crawl, and it is asking about
   *  the whole run rather than about one URL. So the pause is global, the
   *  concurrency drops to one and stays there, and starts are spaced from then
   *  on: a run has no time to earn back the trust, and finishing slowly beats
   *  finishing wrong.
   *
   *  Retry-After is honoured as sent — Shopify asks for 60 seconds, and this
   *  used to cap it at 30, which only guaranteed being refused again. */
  #backOff(res) {
    this.rateLimited++;
    this.refusedInARow++;
    const seconds = waitFor(res.headers?.get?.('retry-after'), this.refusedInARow);
    this.quietUntil = Math.max(this.quietUntil, Date.now() + seconds * 1000);
    this.concurrency = 1;
    this.interval = this.interval ? Math.min(this.interval * 2, 8000) : 1000;
    this.onWait?.({ seconds, status: res.status, url: res.url });
  }

  /** Slow down for a platform known to throttle crawlers before it says so.
   *
   *  Shopify has given unsigned bots its strictest limits since 30 May 2026,
   *  and six requests at once from a crawler are refused nearly every time. The
   *  first response that says it came from Shopify — the home page and the
   *  sitemaps are answered normally — sets one request at a time, a second
   *  apart, before the product pages are asked for. */
  #paceFor(platform) {
    if (this.platform) return;
    this.platform = platform;
    // A signed crawl is the store asking for it, and Shopify gives signed
    // traffic higher limits — slowing it to unsigned speed up front would throw
    // that away. The back-off still applies the moment anything is refused.
    if (this.signed) return;
    this.concurrency = 1;
    this.interval = Math.max(this.interval, 1000);
    this.onPace?.({ platform });
  }

  /** Run `fn` when a slot frees up. */
  #schedule(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        this.active++;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          this.active--;
          const next = this.queue.shift();
          if (next) next();
        }
      };
      if (this.active < this.concurrency) run();
      else this.queue.push(run);
    });
  }

  /**
   * GET a URL. Redirects are NOT followed — a redirect is a finding, not a
   * detour, and following it silently is how "page with redirect" problems go
   * unnoticed.
   * @returns {Promise<{url: string, status: number, ok: boolean, headers: Headers,
   *                    body: string, location: string|null, ms: number, error?: string}>}
   */
  async get(url, { method = 'GET', retries = 2, keepBody = true } = {}) {
    const key = `${method} ${url}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const attempt = async () => {
      await this.#quiet();
      await this.#pace();
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await fetch(url, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            Accept: '*/*',
            ...(this.signed && sameOrigin(url, this.signed.origin) ? this.signed.headers : {}),
          },
        });
        const type = res.headers.get('content-type') ?? '';
        // Only read a body worth parsing; a 40MB video would stall the run.
        const body = method === 'GET' && /text|json|xml/.test(type) ? await res.text() : '';
        this.count++;
        this.timeouts = 0;
        this.reachable = true;
        if (/shopify/i.test(res.headers.get('powered-by') ?? '') || res.headers.has('shopify-complexity-score')) {
          this.#paceFor('shopify');
        }
        const blocked = blockedBy(res.status, res.headers, body);
        return {
          url,
          status: res.status,
          ok: !blocked && res.status >= 200 && res.status < 300,
          headers: res.headers,
          body,
          location: res.headers.get('location'),
          ms: Date.now() - started,
          ...(blocked ? { blocked } : {}),
        };
      } catch (err) {
        return {
          url,
          status: 0,
          ok: false,
          headers: new Headers(),
          body: '',
          location: null,
          ms: Date.now() - started,
          error: err.name === 'AbortError' ? 'timed out' : err.message,
          // A refused connection or an unknown host is an answer, not a blip:
          // retrying cannot change it, and doing so makes a dead site slow to
          // report instead of fast.
          permanent: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_INVALID_URL/.test(
            `${err.code ?? ''} ${err.cause?.code ?? ''} ${err.message}`,
          ),
        };
      } finally {
        clearTimeout(timer);
      }
    };

    // One blip in a 200-page crawl should not be reported as a broken page.
    // Transport failures, 5xx and 429 are retried; a 404 is an answer.
    //
    // 429 was not, until a Shopify store answered it to 70 of 200 pages at the
    // default concurrency and every one was reported as a page that did not
    // load. The pages were fine. Spaced eight seconds apart the same URLs
    // answered 200, on the tool's own user agent — it was the crawl's speed,
    // and reporting the site for it is the worst kind of false positive,
    // because it looks exactly like a site that is broken.
    const promise = this.#schedule(async () => {
      let last;
      // A host the crawl has stopped asking answers for itself, instantly. The
      // alternative is every remaining page sitting out its own five-minute
      // pause to be told no again, and a run that ends in a timeout with
      // nothing rather than a partial report with what it had.
      const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
      if (this.givenUp.has(host)) {
        return {
          url, status: 429, ok: false, headers: new Headers(), body: '', location: null, ms: 0,
          error: 'the host kept refusing, so the crawl stopped asking', gaveUp: true,
        };
      }
      // Refusals are budgeted apart from retries: being asked to wait is not a
      // failed attempt. A caller that asked for no retries gets none of either.
      let patience = retries > 0 ? GIVE_UP_AFTER : 0;
      for (let i = 0; i <= retries; i++) {
        // Once a host has timed out repeatedly and never once answered, stop
        // paying 20 seconds a go to confirm it. Reported as unreachable.
        if (this.timeouts >= 3 && !this.reachable) {
          return {
            url, status: 0, ok: false, headers: new Headers(), body: '',
            location: null, ms: 0, error: 'host is not answering', permanent: true,
          };
        }
        last = await attempt();
        if (last.error === 'timed out') this.timeouts++;
        if (last.permanent) return last;
        if (throttled(last)) {
          this.#backOff(last);
          if (this.refusedInARow >= GIVE_UP_AFTER) {
            this.givenUp.add(host);
            return last;
          }
          if (patience-- <= 0) return last;
          i--;
          continue;
        }
        // Any real answer, including a 404, means the host is listening again.
        if (last.status !== 0) this.refusedInARow = 0;
        // Bot protection does not lift for being asked twice.
        if (last.blocked) return last;
        if (last.status !== 0 && last.status < 500) return last;
        if (i < retries) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
      return last;
    });

    // The caller is handed the whole response; the cache may keep less.
    //
    // The cache is here so a URL is never fetched twice across checks, and for
    // most of what a run fetches that means remembering a status and a
    // content-type — the link sweep, the image sweep and the social-image
    // sweeps all judge on those alone. Keeping every body as well made the
    // cache the largest live object in the process: 403 requests on one 25-page
    // site held 65MB, of which 18MB was still reachable once the run let go.
    // That is under Node's default heap and over Raycast's, whose commands get
    // 100MB and were dying on sites this tool audits comfortably from a
    // terminal.
    //
    // So a sweep asks for `keepBody: false` and the body is dropped on the way
    // into the cache, never on the way out — whoever fetched it reads it in
    // full, and only a *second* reader of the same URL sees an empty body. The
    // page crawl, robots.txt, the home page and the host checks all keep
    // theirs, because something does read those twice.
    this.cache.set(key, keepBody ? promise : promise.then((res) => ({ ...res, body: '' })));
    return promise;
  }

  /**
   * Wait until a URL serves the same bytes several times in a row.
   *
   * A CDN rolls a deploy out unevenly: for a minute or two one edge answers
   * with the new page and another with the old, and a crawl during that window
   * produces a snapshot that is wrong in a way nobody can reproduce later.
   */
  async settle(url, seconds) {
    const deadline = Date.now() + seconds * 1000;
    const wanted = 3;
    let previous = null;
    let same = 0;
    while (Date.now() < deadline) {
      this.cache.delete(`GET ${url}`);
      const res = await this.get(url, { retries: 0 });
      const fingerprint = `${res.status}:${res.body.length}:${res.headers.get('etag') ?? ''}`;
      same = fingerprint === previous ? same + 1 : 0;
      previous = fingerprint;
      if (same >= wanted - 1) return true;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
  }

  /** Follow a chain by hand so the number of hops can be reported. */
  async chain(url, max = 5, { keepBody = true } = {}) {
    const hops = [];
    let current = url;
    for (let i = 0; i < max; i++) {
      const res = await this.get(current, { keepBody });
      hops.push({ url: current, status: res.status });
      if (res.status < 300 || res.status >= 400 || !res.location) return { hops, final: res };
      current = new URL(res.location, current).toString();
    }
    return { hops, final: await this.get(current, { keepBody }) };
  }
}

/** Run tasks with a cap, preserving input order in the results. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
