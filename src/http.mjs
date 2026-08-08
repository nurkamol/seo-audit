// Fetching, with the two things a crawler actually needs: a concurrency limit
// so a small site is not hammered, and a cache so the same URL is never
// fetched twice across checks.

const UA = 'seo-audit (+https://github.com/nurkamol/seo-audit)';

export class Fetcher {
  /** @param {{concurrency?: number, timeout?: number}} opts */
  constructor({ concurrency = 6, timeout = 20000 } = {}) {
    this.timeout = timeout;
    this.cache = new Map();
    this.queue = [];
    this.active = 0;
    this.concurrency = concurrency;
    this.count = 0;
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
  async get(url, { method = 'GET' } = {}) {
    const key = `${method} ${url}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const promise = this.#schedule(async () => {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await fetch(url, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': UA, Accept: '*/*' },
        });
        const type = res.headers.get('content-type') ?? '';
        // Only read a body worth parsing; a 40MB video would stall the run.
        const body = method === 'GET' && /text|json|xml/.test(type) ? await res.text() : '';
        this.count++;
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
        };
      } finally {
        clearTimeout(timer);
      }
    });

    this.cache.set(key, promise);
    return promise;
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
