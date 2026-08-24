// PageSpeed Insights.
//
// Everywhere else this tool refuses to talk about performance, because a fetch
// loop cannot see rendering and a plausible-looking wrong number is worse than
// no number. Asking Google for its own measurement is a different thing: this
// is Lighthouse, run by Google, on Google's hardware — the same figure the
// PageSpeed Insights page shows.
//
// It is slow (~12s per URL) and rate-limited, so it runs on the pages you name
// rather than the whole sitemap, and never by default.
//
// A key is optional but raises the quota well above the anonymous limit. Set
// PSI_API_KEY, or put it in ~/.config/seo-audit/.env — never in the repo.
import { matchGlob, readSecret } from './config.mjs';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// Roughly a minute of measuring per section. Enough to tell whether a template
// is slow — which is the question a section is asked — without turning an audit
// into a coffee break.
export const DEFAULT_SAMPLE = 3;

// What one PSI call costs, near enough to warn someone before they wait for it.
const SECONDS_PER_URL = 12;

// Google's own thresholds for "good" and "poor".
const CWV = {
  lcp: { good: 2500, poor: 4000, label: 'Largest Contentful Paint' },
  cls: { good: 0.1, poor: 0.25, label: 'Cumulative Layout Shift' },
  inp: { good: 200, poor: 500, label: 'Interaction to Next Paint' },
};

export function findKey() {
  // Shared with the Search Console credentials rather than copied. The copy
  // this file did not have was broken for months without anything noticing.
  return readSecret('PSI_API_KEY');
}

async function run(url, strategy, key) {
  const params = new URLSearchParams({ url, strategy, category: 'performance' });
  if (key) params.set('key', key);
  const res = await fetch(`${ENDPOINT}?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

const f = (level, id, title, detail, url) => ({ level, id, title, detail, url });

/** `n` items spread across a list, rather than the first n.
 *
 *  Deterministic on purpose. A random sample would measure different pages on
 *  every run, and --baseline would then report the change as a regression. */
function spread(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

export const estimateSeconds = (n) => n * SECONDS_PER_URL;

/** Resolve --psi entries against the pages actually crawled.
 *
 *  A URL or a path is measured as given. A path glob names a section — every
 *  crawled page under it, sampled down to `sample`, because a section of forty
 *  pages measured whole is eight minutes of waiting.
 *
 *  Returns { urls, notes }. The notes report what matched but was not measured:
 *  a sampled section must never read as a clean bill of health for the whole
 *  section, which is exactly how a silent cap would read. */
export function psiTargets(entries, pageUrls, { origin, sample = DEFAULT_SAMPLE } = {}) {
  const urls = [];
  const notes = [];

  for (const entry of entries) {
    if (!entry.includes('*')) {
      try {
        urls.push(new URL(entry, origin).toString());
      } catch {
        notes.push(f('info', 'psi-no-match', `Not a URL or path: ${entry}`,
          'Pass a full URL, a path, or a path glob such as /journal/**.', origin));
      }
      continue;
    }

    const matched = pageUrls.filter((u) => {
      try {
        return matchGlob(entry, new URL(u).pathname);
      } catch {
        return false;
      }
    });

    if (!matched.length) {
      notes.push(f('info', 'psi-no-match', `No crawled page matches ${entry}`,
        'Nothing was measured for this pattern. Globs match URL paths, where `*` stops at a slash and `**` does not.', origin));
      continue;
    }

    const picked = spread(matched, sample);
    urls.push(...picked);
    if (picked.length < matched.length) {
      notes.push(f('info', 'psi-sampled', `Measured ${picked.length} of the ${matched.length} pages under ${entry}`,
        `A sample, spread across the section — at ~${SECONDS_PER_URL}s a page, measuring all ${matched.length} would take ` +
        `${Math.ceil(estimateSeconds(matched.length) / 60)} minutes. The other ${matched.length - picked.length} were not looked at; ` +
        'raise the sample with --psi-sample, and expect the wait.', origin));
    }
  }

  return { urls: [...new Set(urls)], notes };
}

/**
 * @param {string[]} urls pages to measure — a handful, not a sitemap
 * @param {{strategy?: 'mobile'|'desktop', key?: string|null}} opts
 */
export async function psiChecks(urls, { strategy = 'mobile', key = findKey(), onProgress } = {}) {
  const out = [];

  for (const [i, url] of urls.entries()) {
    let data;
    // Announced before rather than after: each call takes about twelve seconds,
    // which is a long time to sit looking at nothing.
    onProgress?.({ phase: 'psi', url, detail: `measuring ${i + 1} of ${urls.length} (~12s)` });
    try {
      data = await run(url, strategy, key);
    } catch (err) {
      out.push(f('info', 'psi-failed', 'PageSpeed Insights could not measure this page',
        `${err.message}${key ? '' : ' (no PSI_API_KEY set — the anonymous quota is small)'}`, url));
      continue;
    }

    const lr = data.lighthouseResult;
    const audits = lr.audits;
    const score = Math.round((lr.categories.performance.score ?? 0) * 100);

    if (score < 50) {
      out.push(f('error', 'psi-score', `Performance ${score}/100 on ${strategy}`,
        'Google rates this poor. The opportunities below say why.', url));
    } else if (score < 90) {
      out.push(f('warn', 'psi-score', `Performance ${score}/100 on ${strategy}`,
        'Google rates this "needs improvement".', url));
    }

    // Lab metrics against Google's own good/poor boundaries.
    const metrics = {
      lcp: audits['largest-contentful-paint']?.numericValue,
      cls: audits['cumulative-layout-shift']?.numericValue,
    };
    for (const [name, value] of Object.entries(metrics)) {
      if (value == null) continue;
      const { good, poor, label } = CWV[name];
      const shown = audits[name === 'lcp' ? 'largest-contentful-paint' : 'cumulative-layout-shift']
        .displayValue;
      if (value > poor) {
        out.push(f('error', `psi-${name}`, `${label} is poor: ${shown}`,
          `Google's threshold for "good" is ${name === 'cls' ? good : `${good / 1000}s`}.`, url));
      } else if (value > good) {
        out.push(f('warn', `psi-${name}`, `${label} needs improvement: ${shown}`,
          `Google's threshold for "good" is ${name === 'cls' ? good : `${good / 1000}s`}.`, url));
      }
    }

    // Opportunities worth a quarter of a second or more, named by Google.
    for (const audit of Object.values(audits)) {
      const saving = audit.details?.overallSavingsMs ?? 0;
      if (saving >= 250) {
        out.push(f('warn', 'psi-opportunity', `${audit.title} — ${Math.round(saving)}ms`,
          (audit.description ?? '').split('. ')[0] + '.', url));
      }
    }

    // Field data, when Google has enough real visitors to report it. This is
    // what actually counts for ranking; the lab numbers above are a rehearsal.
    const field = data.loadingExperience?.metrics;
    if (field) {
      for (const [key_, metric] of Object.entries({
        LARGEST_CONTENTFUL_PAINT_MS: 'lcp',
        CUMULATIVE_LAYOUT_SHIFT_SCORE: 'cls',
        INTERACTION_TO_NEXT_PAINT: 'inp',
      })) {
        const entry = field[key_];
        if (entry && entry.category === 'SLOW') {
          out.push(f('error', `psi-field-${metric}`, `Real visitors see a poor ${CWV[metric].label}`,
            `Chrome field data, not a lab test — this is the number Google ranks on.`, url));
        }
      }
    } else {
      out.push(f('info', 'psi-no-field-data', 'No real-visitor performance data yet',
        'Chrome reports field data once a site has enough traffic. Lab numbers are all there is for now.', url));
    }
  }

  return out;
}
