// Fetching, with the two things a crawler actually needs: a concurrency limit
// so a small site is not hammered, and a cache so the same URL is never
// fetched twice across checks.

const DEFAULT_UA = 'seo-audit (+https://github.com/nurkamol/seo-audit)';

export class Fetcher {
  /** @param {{concurrency?: number, timeout?: number}} opts */
  constructor({ concurrency = 6, timeout = 20000, userAgent = DEFAULT_UA } = {}) {
    this.timeout = timeout;
    this.userAgent = userAgent;
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

  /** Wait out a rate limit, if one is in force. */
  async #quiet() {
    const wait = this.quietUntil - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  /** A 429 is the server asking for a slower crawl, and it is asking about the
   *  whole run rather than about one URL. So the pause is global, and the
   *  concurrency halves and stays down: a short run has no time to earn back
   *  the trust, and finishing slowly beats finishing wrong.
   *
   *  Retry-After is honoured where it is sent and capped where it is absurd —
   *  a store asking for an hour is asking for a different tool. Shopify sends
   *  none at all, which is why there is a default. */
  #backOff(res) {
    this.rateLimited++;
    const asked = Number.parseInt(res.headers?.get?.('retry-after') ?? '', 10);
    // Without a Retry-After the wait doubles to a ceiling of eight seconds.
    // Thirty would be defensible per request and ruinous across two hundred of
    // them: the concurrency coming down is what actually gets a run through a
    // rate limit, and the pause only has to be long enough to let it.
    const seconds =
      Number.isFinite(asked) && asked > 0 ? Math.min(asked, 30) : Math.min(2 ** Math.min(this.rateLimited, 3), 8);
    this.quietUntil = Math.max(this.quietUntil, Date.now() + seconds * 1000);
    this.concurrency = Math.max(1, Math.floor(this.concurrency / 2));
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
  async get(url, { method = 'GET', retries = 2 } = {}) {
    const key = `${method} ${url}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const attempt = async () => {
      await this.#quiet();
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await fetch(url, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': this.userAgent, Accept: '*/*' },
        });
        const type = res.headers.get('content-type') ?? '';
        // Only read a body worth parsing; a 40MB video would stall the run.
        const body = method === 'GET' && /text|json|xml/.test(type) ? await res.text() : '';
        this.count++;
        this.timeouts = 0;
        this.reachable = true;
        return {
          url,
          status: res.status,
          ok: res.status >= 200 && res.status < 300,
          headers: res.headers,
          body,
          location: res.headers.get('location'),
          ms: Date.now() - started,
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
        if (last.status === 429) {
          this.#backOff(last);
          // A host that has said no twenty times is not going to say yes
          // because it was asked again. Let each page report the rate limit
          // and let the run finish, rather than spending an hour proving it.
          if (this.rateLimited > 20) return last;
          continue;
        }
        if (last.status !== 0 && last.status < 500) return last;
        if (i < retries) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
      return last;
    });

    this.cache.set(key, promise);
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
  async chain(url, max = 5) {
    const hops = [];
    let current = url;
    for (let i = 0; i < max; i++) {
      const res = await this.get(current);
      hops.push({ url: current, status: res.status });
      if (res.status < 300 || res.status >= 400 || !res.location) return { hops, final: res };
      current = new URL(res.location, current).toString();
    }
    return { hops, final: await this.get(current) };
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
