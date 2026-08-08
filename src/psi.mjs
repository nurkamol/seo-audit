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
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// Google's own thresholds for "good" and "poor".
const CWV = {
  lcp: { good: 2500, poor: 4000, label: 'Largest Contentful Paint' },
  cls: { good: 0.1, poor: 0.25, label: 'Cumulative Layout Shift' },
  inp: { good: 200, poor: 500, label: 'Interaction to Next Paint' },
};

export function findKey() {
  if (process.env.PSI_API_KEY) return process.env.PSI_API_KEY;
  const dotfile = join(homedir(), '.config', 'seo-audit', '.env');
  if (!existsSync(dotfile)) return null;
  const match = readFileSync(dotfile, 'utf8').match(/^\s*PSI_API_KEY\s*=\s*(\S+)/m);
  return match?.[1] ?? null;
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

/**
 * @param {string[]} urls pages to measure — a handful, not a sitemap
 * @param {{strategy?: 'mobile'|'desktop', key?: string|null}} opts
 */
export async function psiChecks(urls, { strategy = 'mobile', key = findKey() } = {}) {
  const out = [];

  for (const url of urls) {
    let data;
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
