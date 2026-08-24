// Configuration: what this site has decided to live with.
//
// Every real site has findings that are true and deliberate — a contact page
// is meant to be short, a privacy policy has no business carrying editorial
// links. Without a way to say so, the report fills with noise nobody reads,
// and the one new finding that matters is lost in it.
//
// Looked for in the working directory, or passed with --config:
//
//   seo-audit.config.json
//   {
//     "limit": 200,
//     "failOn": "error",
//     "ignore": [
//       "img-srcset",                                  // everywhere
//       { "id": "thin-content", "urls": ["/contact/", "/*/legal/**"] },
//       { "id": "no-editorial-links", "urls": ["**/privacy-policy/"] }
//     ],
//     "expect": [
//       { "urls": ["/journal/*/"], "types": ["BlogPosting"] },
//       { "urls": ["/"], "types": ["LocalBusiness"] }
//     ]
//   }
import { readFileSync, existsSync } from 'node:fs';

const FILENAMES = ['seo-audit.config.json', '.seo-audit.json'];

/** Glob over URL paths: `*` stops at a slash, `**` does not. */
export function matchGlob(pattern, path) {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // A placeholder while `*` is translated, written as an escape rather than
    // as the byte itself: a raw NUL in the source makes this file binary to
    // git and invisible to grep, which is how it went unnoticed that the glob
    // matcher lived here at all.
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${rx}$`).test(path);
}

/** A rule matches a finding when the id matches and, if the rule names URLs,
 *  one of them matches the finding's path. */
// Ids that used to be one check. A config in somebody's repository is written
// against the ids that existed when they wrote it, and splitting a check is our
// decision, not theirs — so the old id keeps silencing what it used to silence.
// The alternative is a check they had accepted starting to fail their build on
// an upgrade that promised to be compatible.
const RETIRED_IDS = {
  // Split in 1.32.0: one id covered three tags, so a group named one of them
  // and counted all three.
  'og-missing': ['og-title-missing', 'og-description-missing', 'og-image-missing'],
};

function ruleMatches(rule, finding) {
  const id = typeof rule === 'string' ? rule : rule.id;
  if (id !== finding.id && !RETIRED_IDS[id]?.includes(finding.id)) return false;
  const urls = typeof rule === 'string' ? null : rule.urls;
  if (!urls?.length) return true;
  if (!finding.url) return false;
  let path;
  try {
    path = new URL(finding.url).pathname;
  } catch {
    path = finding.url;
  }
  return urls.some((u) => matchGlob(u, path));
}

export function loadConfig(explicitPath) {
  const path = explicitPath ?? FILENAMES.find((f) => existsSync(f));
  if (!path) return { source: null };
  if (!existsSync(path)) throw new Error(`Config not found: ${path}`);
  try {
    return { ...JSON.parse(readFileSync(path, 'utf8')), source: path };
  } catch (err) {
    throw new Error(`Config is not valid JSON (${path}): ${err.message}`);
  }
}

/** The sites to audit, each with whatever it overrides.
 *
 *  A portfolio is not a list of interchangeable sites: one has a deliberately
 *  short contact page, another has no journal to expect BlogPosting on. So a
 *  `sites` entry may be a bare URL or an object carrying its own settings,
 *  which are merged over the shared config rather than replacing it.
 *
 *    "sites": [
 *      "https://one.example",
 *      { "url": "https://two.example", "ignore": ["thin-content"], "limit": 50 }
 *    ]
 *
 *  URLs given on the command line win over the config file entirely, because
 *  naming sites explicitly is how you audit a subset of a portfolio. */
export function resolveSites(positional = [], file = {}) {
  const list = positional.length ? positional : (file.sites ?? []);
  return list
    .map((entry) => (typeof entry === 'string' ? { url: entry } : { ...entry }))
    .filter((entry) => entry.url)
    .map(({ url, ...overrides }) => ({
      url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
      overrides,
    }));
}

/** Shared options with one site's overrides on top. `ignore` accumulates,
 *  since a portfolio rule and a site rule are both meant to apply. */
export function optionsForSite(shared, overrides = {}) {
  return {
    ...shared,
    ...overrides,
    ignore: [...(shared.ignore ?? []), ...(overrides.ignore ?? [])],
  };
}

/** Drop findings the site has accepted. Returns [kept, ignoredCount]. */
export function applyIgnores(findings, ignore = []) {
  if (!ignore.length) return [findings, 0];
  const kept = findings.filter((f) => !ignore.some((rule) => ruleMatches(rule, f)));
  return [kept, findings.length - kept.length];
}

/** Structured-data expectations, as findings. `expect` says which schema types
 *  a group of pages must carry — the difference between "the JSON parses" and
 *  "this article is actually marked up as an article". */
export function expectationChecks(pages, expect = []) {
  const out = [];
  if (!expect.length) return out;

  for (const page of pages) {
    if (!page.doc) continue;
    let path;
    try {
      path = new URL(page.url).pathname;
    } catch {
      continue;
    }
    const rules = expect.filter((rule) => rule.urls.some((u) => matchGlob(u, path)));
    if (!rules.length) continue;

    // Every @type on the page, including those nested in a @graph.
    const types = new Set();
    const collect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(collect);
      for (const t of [node['@type']].flat().filter(Boolean)) types.add(t);
      if (node['@graph']) collect(node['@graph']);
    };
    for (const block of page.doc.jsonld) if (block.ok) collect(block.data);

    for (const rule of rules) {
      const missing = rule.types.filter((t) => !types.has(t));
      if (missing.length) {
        out.push({
          level: 'error',
          id: 'schema-expected',
          title: `Missing expected structured data: ${missing.join(', ')}`,
          detail: types.size
            ? `Page declares ${[...types].join(', ')}.`
            : 'Page has no structured data at all.',
          url: page.url,
        });
      }
    }
  }
  return out;
}
