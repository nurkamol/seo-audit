// A number out of 100, and the checks that passed to earn it.
//
// This project has refused a score everywhere else, and the refusal still
// stands for the thing people usually mean by one: nothing here predicts a
// ranking, estimates traffic, or grades a site against its competitors. Those
// numbers are invented, and an invented number is worse than no number.
//
// What this is instead is a **checklist that has been counted**. The engine
// runs a fixed set of checks; this says how many of them a site passes, and
// the arithmetic is small enough to print:
//
//   * A run starts at 100 and pays for what is wrong with it. Nothing is added
//     for passing; a site that passes everything is at 100 because nothing
//     took points off it.
//   * A check is scored only if it can fire at error or warning level. Notes
//     are "worth knowing, may be deliberate" — an `llms.txt` nobody wanted is
//     not a fault, and a score that docked points for one would be lying.
//   * An error-level check costs 12 points, a warning 4. The ratio is not a new
//     judgement: every check already carries a level, chosen check by check
//     when it was written and argued over in review.
//     `scripts/check-levels.mjs` reads those levels back out of the source and
//     the test asserts this table still matches, so a check promoted from
//     warning to error cannot keep its old weight. The size is a choice, and
//     the one it makes is that eight site-wide errors is a site with nothing
//     left to score.
//   * A check on some pages costs its share of that: a missing `<h1>` on 3 of
//     40 pages costs a tenth of a warning, and the same fault on all 40 costs
//     the whole of one. What a check costs is what fixing it is worth, and the
//     report prints that beside every piece of work.
//   * A check that never had the chance to run cannot cost anything, and is
//     listed as skipped rather than as passed. A site with no images has not
//     "passed" the alt-text check, and a run without `--psi` has not passed
//     the performance ones — calling either a pass hands out credit for doing
//     less.
//
// So the score is an amount of known, named, locatable work, subtracted from a
// clean sheet. Two runs of the same site are comparable, and a run of one site
// against another is comparable to the degree that the same checks applied to
// both — which the report says out loud.
//
// The score is computed in the engine and shipped in the report, so the
// terminal, the Markdown, the HTML, the macOS window and the Raycast extension
// all show the same number rather than four arithmetics that drift.

import { categoryOf, CATEGORIES } from './areas.mjs';

/** What a check costs when it fails everywhere it could. An error is worth
 *  three warnings, which is the ratio the levels themselves already carry. */
export const WEIGHT = { error: 12, warn: 4 };

// --- The checklist ----------------------------------------------------------
// `worst` is the most serious level the check can fire at, and therefore what
// it costs. `scope` says how a partial failure is counted: a `page` check costs
// its share of the crawl, a `site` check is one yes or no for the whole domain.
// `needs` names the thing that has to be true for the check to have applied at
// all — without it, the check cannot cost anything and is reported as skipped.
//
// `pass` is what it says when it passes, in the present tense, because that is
// the only place this sentence can be written: a check that does not fire
// produces no finding and therefore no title.
//
// Checks that can only ever be notes are absent on purpose, and so are the ones
// in NOT_SCORED below.
/** Checks that fire at error or warning level and are still not scored, with
 *  the reason. All three describe the run rather than the site: a server that
 *  rate-limited the crawl, a sitemap that could not be reached to be read, a
 *  `--since` the sitemap could not answer. Docking a site for any of them would
 *  score the network between here and there.
 *
 *  Named rather than merely omitted, because the test asserts that every check
 *  emitted above note level is either in the checklist or in here — an
 *  omission by oversight would otherwise look exactly like this one. */
export const NOT_SCORED = {
  'crawl-rate-limited': 'The server rate-limited the crawl. That is a fact about the run.',
  'sitemap-not-checked': 'The sitemap could not be reached to be read, which says nothing about it.',
  'since-not-usable': 'The sitemap could not answer --since. A refusal, not a fault.',
};

const CHECKLIST = {
  // --- Indexability ---------------------------------------------------------
  'page-status': { worst: 'error', scope: 'page', pass: 'Every page answers 200' },
  unreachable: { worst: 'error', scope: 'site', pass: 'The site answers' },
  'nothing-crawlable': { worst: 'error', scope: 'site', pass: 'There is something to crawl' },
  noindex: { worst: 'error', scope: 'page', pass: 'No page in the sitemap says noindex' },
  'x-robots-noindex': { worst: 'error', scope: 'page', pass: 'No X-Robots-Tag hides a page' },
  'nofollow-page': { worst: 'warn', scope: 'page', pass: 'No page tells Google to follow none of its links' },
  'robots-conflict': { worst: 'warn', scope: 'page', pass: 'The robots meta and header agree' },
  'body-not-html': { worst: 'warn', scope: 'page', pass: 'Every page served as HTML is HTML' },
  'soft-404': { worst: 'error', scope: 'site', pass: 'A URL that cannot exist returns 404' },
  'canonical-missing': { worst: 'warn', scope: 'page', pass: 'Every page declares a canonical' },
  'canonical-multiple': { worst: 'error', scope: 'page', pass: 'No page declares two canonicals' },
  'canonical-dead': { worst: 'error', scope: 'page', pass: 'Every canonical target loads' },
  'canonical-redirects': { worst: 'error', scope: 'page', pass: 'No canonical points at a redirect' },
  'canonical-noindex': { worst: 'error', scope: 'page', pass: 'No canonical points at a noindexed page' },
  'canonical-paginated': { worst: 'error', scope: 'page', pass: 'Paginated pages name themselves' },
  'canonical-chain': { worst: 'warn', scope: 'page', pass: 'No canonical target is canonicalised again' },
  'serves-differently': { worst: 'warn', scope: 'page', needs: 'compareAs', pass: 'Pages read the same to another visitor' },

  // --- Content --------------------------------------------------------------
  'title-missing': { worst: 'error', scope: 'page', pass: 'Every page has a title' },
  'title-long': { worst: 'warn', scope: 'page', pass: 'No title is cut off in results' },
  'title-short': { worst: 'warn', scope: 'page', pass: 'No title is too short to describe the page' },
  'desc-missing': { worst: 'warn', scope: 'page', pass: 'Every page has a meta description' },
  'desc-long': { worst: 'warn', scope: 'page', pass: 'No meta description is cut off' },
  'h1-missing': { worst: 'error', scope: 'page', pass: 'Every page has an h1' },
  'h1-multiple': { worst: 'warn', scope: 'page', pass: 'No page has two h1s' },
  'heading-skip': { worst: 'warn', scope: 'page', pass: 'Heading levels do not skip' },
  'thin-content': { worst: 'warn', scope: 'page', pass: 'Every page has enough content to read' },
  'duplicate-title': { worst: 'warn', scope: 'page', needs: 'multipage', pass: 'No two pages share a title' },
  'duplicate-description': { worst: 'warn', scope: 'page', needs: 'multipage', pass: 'No two pages share a description' },
  'duplicate-content': { worst: 'warn', scope: 'page', needs: 'fingerprints', pass: 'No page is another page again' },
  'lang-missing': { worst: 'warn', scope: 'page', pass: 'Every page declares its language' },
  'charset-missing': { worst: 'warn', scope: 'page', pass: 'Every page declares its character set' },
  'viewport-missing': { worst: 'error', scope: 'page', pass: 'Every page declares a viewport' },
  'viewport-locked': { worst: 'warn', scope: 'page', pass: 'No viewport blocks zooming' },
  'viewport-fixed-width': { worst: 'warn', scope: 'page', pass: 'No viewport is a fixed pixel width' },

  // --- Links ----------------------------------------------------------------
  'broken-link': { worst: 'error', scope: 'page', pass: 'Every internal link resolves' },
  'external-broken': { worst: 'warn', scope: 'page', needs: 'external', pass: 'Every outbound link resolves' },
  'orphan-page': { worst: 'warn', scope: 'page', needs: 'sitemap', pass: 'No page is linked from nowhere' },
  'no-path-from-home': { worst: 'warn', scope: 'page', needs: 'multipage', pass: 'Every page is reachable from the homepage' },
  'link-no-text': { worst: 'warn', scope: 'page', pass: 'Every destination has a link that names it' },
  'missing-from-sitemap': { worst: 'warn', scope: 'page', needs: 'sitemap', pass: 'Every linked page is in the sitemap' },
  'meta-refresh': { worst: 'warn', scope: 'page', pass: 'No page redirects with a meta refresh' },

  // --- Redirects ------------------------------------------------------------
  'sitemap-redirect': { worst: 'error', scope: 'page', needs: 'sitemap', pass: 'No sitemap URL redirects' },
  'redirect-chain': { worst: 'warn', scope: 'page', pass: 'No redirect takes more than one hop' },
  'trailing-slash': { worst: 'warn', scope: 'site', pass: 'Trailing slashes are consistent' },
  'host-variant-dead': { worst: 'warn', scope: 'site', pass: 'Every host variant reaches the site' },
  'redirect-dead': { worst: 'error', scope: 'site', needs: 'redirects', pass: 'Every URL in the redirect map still leads somewhere' },
  'redirect-broken': { worst: 'error', scope: 'site', needs: 'redirects', pass: 'Every redirect lands on a page that loads' },
  'redirect-not-applied': { worst: 'warn', scope: 'site', needs: 'redirects', pass: 'Every rule in the map is in effect' },
  'redirect-hops': { worst: 'warn', scope: 'site', needs: 'redirects', pass: 'No redirect takes more than one hop' },
  'redirect-elsewhere': { worst: 'warn', scope: 'site', needs: 'redirects', pass: 'Every redirect lands where the map says' },
  'redirect-temporary': { worst: 'warn', scope: 'site', needs: 'redirects', pass: 'Permanent redirects are served as 301' },

  // --- Images ---------------------------------------------------------------
  'img-alt': { worst: 'error', scope: 'page', needs: 'images', pass: 'Every image has an alt attribute' },
  'img-alt-filename': { worst: 'warn', scope: 'page', needs: 'images', pass: 'No alt text is a filename' },
  'img-alt-placeholder': { worst: 'warn', scope: 'page', needs: 'images', pass: 'No alt text is a placeholder' },
  'img-dimensions': { worst: 'warn', scope: 'page', needs: 'images', pass: 'Every image declares width and height' },
  'broken-image': { worst: 'error', scope: 'page', needs: 'images', pass: 'Every image loads' },

  // --- Social ---------------------------------------------------------------
  'og-title-missing': { worst: 'warn', scope: 'page', pass: 'Every page has an og:title' },
  'og-description-missing': { worst: 'warn', scope: 'page', pass: 'Every page has an og:description' },
  'og-image-missing': { worst: 'warn', scope: 'page', pass: 'Every page has an og:image' },
  'og-image-relative': { worst: 'error', scope: 'page', needs: 'ogImage', pass: 'Every og:image is an absolute URL' },
  'og-image-broken': { worst: 'error', scope: 'page', needs: 'ogImage', pass: 'Every og:image loads' },
  'og-image-heavy': { worst: 'warn', scope: 'page', needs: 'ogImage', pass: 'No og:image is too heavy to scrape' },
  'og-webp': { worst: 'warn', scope: 'page', needs: 'ogImage', pass: 'No og:image is WebP' },
  'twitter-image-broken': { worst: 'error', scope: 'page', needs: 'twitterImage', pass: 'Every twitter:image loads' },

  // --- Structured data ------------------------------------------------------
  'jsonld-invalid': { worst: 'error', scope: 'page', needs: 'jsonld', pass: 'All JSON-LD parses' },
  'jsonld-no-type': { worst: 'warn', scope: 'page', needs: 'jsonld', pass: 'All JSON-LD declares a @type' },
  'schema-incomplete': { worst: 'warn', scope: 'page', needs: 'jsonld', pass: 'Structured data carries what Google requires' },
  'schema-date-order': { worst: 'warn', scope: 'page', needs: 'jsonld', pass: 'Structured-data dates do not contradict each other' },
  'schema-date-future': { worst: 'warn', scope: 'page', needs: 'jsonld', pass: 'No structured-data date is in the future' },
  'schema-image-broken': { worst: 'warn', scope: 'page', needs: 'jsonld', pass: 'Images named in structured data load' },
  'schema-expected': { worst: 'error', scope: 'page', needs: 'expect', pass: 'Pages carry the schema types expected of them' },

  // --- Multilingual ---------------------------------------------------------
  'hreflang-invalid': { worst: 'error', scope: 'page', needs: 'hreflang', pass: 'Every hreflang code is well formed' },
  'hreflang-one-way': { worst: 'error', scope: 'page', needs: 'hreflang', pass: 'hreflang is reciprocal' },
  'hreflang-dead': { worst: 'error', scope: 'page', needs: 'hreflang', pass: 'Every hreflang alternate loads' },
  'hreflang-no-self': { worst: 'warn', scope: 'page', needs: 'hreflang', pass: 'Every hreflang set lists its own page' },
  'hreflang-lang-mismatch': { worst: 'warn', scope: 'page', needs: 'hreflang', pass: 'html lang agrees with hreflang' },
  'content-language-mismatch': { worst: 'warn', scope: 'page', pass: 'html lang agrees with the Content-Language header' },

  // --- Sitemap & robots -----------------------------------------------------
  'no-sitemap': { worst: 'warn', scope: 'site', pass: 'The site has a sitemap' },
  'robots-missing': { worst: 'warn', scope: 'site', pass: 'robots.txt is there' },
  'robots-blocks-all': { worst: 'error', scope: 'site', pass: 'robots.txt does not block the site' },
  'robots-blocks-sitemap-url': { worst: 'error', scope: 'site', needs: 'sitemap', pass: 'robots.txt does not block its own sitemap URLs' },
  'sitemap-not-indexable': { worst: 'warn', scope: 'site', needs: 'sitemap', pass: 'Every sitemap URL is indexable' },
  'sitemap-lastmod-future': { worst: 'warn', scope: 'site', needs: 'sitemap', pass: 'No lastmod is in the future' },
  'sitemap-too-many-urls': { worst: 'error', scope: 'site', needs: 'sitemap', pass: 'Every sitemap file is within 50,000 URLs' },
  'sitemap-too-large': { worst: 'error', scope: 'site', needs: 'sitemap', pass: 'Every sitemap file is within 50MB' },

  // --- AI & answer engines --------------------------------------------------
  // Only the contradiction is scored. Disallowing an AI crawler is a decision a
  // publisher is entitled to make, and a score that docked points for it would
  // be grading somebody's licensing policy — `ai-crawler-blocked` is a note and
  // stays one.
  'ai-crawler-conflict': { worst: 'warn', scope: 'site', needs: 'llmsTxt', pass: 'robots.txt and llms.txt agree about AI assistants' },

  // --- Site & security ------------------------------------------------------
  'favicon-broken': { worst: 'warn', scope: 'site', pass: 'The favicon loads' },
  'mixed-content': { worst: 'error', scope: 'page', needs: 'https', pass: 'No page loads an insecure subresource' },
  'tls-expired': { worst: 'error', scope: 'site', needs: 'tls', pass: 'The TLS certificate is valid' },
  'tls-expiring': { worst: 'warn', scope: 'site', needs: 'tls', pass: 'The TLS certificate is not about to expire' },
  'header-strict-transport-security': { worst: 'warn', scope: 'site', needs: 'https', pass: 'HSTS is set' },
  'url-uppercase': { worst: 'warn', scope: 'page', pass: 'No URL has uppercase in its path' },
  'url-space': { worst: 'warn', scope: 'page', pass: 'No URL has a space in it' },
  uncompressed: { worst: 'warn', scope: 'page', pass: 'HTML arrives compressed' },

  // --- Performance ----------------------------------------------------------
  // Measured by Google, never estimated here — which is why every one of these
  // needs `--psi` before it counts for or against anything.
  'psi-score': { worst: 'error', scope: 'page', needs: 'psi', pass: 'PageSpeed scores the pages well' },
  'psi-lcp': { worst: 'error', scope: 'page', needs: 'psi', pass: 'Largest Contentful Paint is good in the lab' },
  'psi-cls': { worst: 'error', scope: 'page', needs: 'psi', pass: 'Cumulative Layout Shift is good in the lab' },
  'psi-inp': { worst: 'error', scope: 'page', needs: 'psi', pass: 'Interaction to Next Paint is good in the lab' },
  'psi-field-lcp': { worst: 'error', scope: 'page', needs: 'psiField', pass: 'Real visitors get a good Largest Contentful Paint' },
  'psi-field-cls': { worst: 'error', scope: 'page', needs: 'psiField', pass: 'Real visitors get a good Cumulative Layout Shift' },
  'psi-field-inp': { worst: 'error', scope: 'page', needs: 'psiField', pass: 'Real visitors get a good Interaction to Next Paint' },
  'psi-opportunity': { worst: 'warn', scope: 'page', needs: 'psi', pass: 'PageSpeed found nothing worth a second' },
};

export { CHECKLIST };

/** Every scored check, so the checklist can be listed without running an audit
 *  — `/checks` serves this, and the README table is written against it. */
export function checklist() {
  return Object.entries(CHECKLIST).map(([id, check]) => ({
    id,
    ...check,
    weight: WEIGHT[check.worst],
    area: categoryOf(id),
  }));
}

/** A letter, because 71 and 79 read the same and B and C do not.
 *
 *  School grades rather than anything invented: 90 is an A, 80 a B, and so on
 *  down. Nothing hangs on the letter — it is the same number, said again. */
export function gradeOf(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Two runs are only comparable where the same checks applied to both. */
const applies = (check, applicable, fired) =>
  fired || !check.needs || applicable[check.needs] === true;

/** Score a run.
 *
 *  `findings` is the kept findings — after ignore rules, so a site that has
 *  decided to live with something is not docked for it. `pages` is how many
 *  were crawled, and `applicable` is what the run was actually in a position
 *  to check, which `src/audit.mjs` works out from the crawl itself.
 *
 *  Returns `null` when there was nothing to score: a site that did not answer,
 *  or a run with no crawlable page, has no share of a checklist to report and
 *  a 0 would read as "this site fails every check" rather than "this did not
 *  run". */
export function scoreRun(findings, { pages = 0, applicable = {} } = {}) {
  const fatal = new Set(['unreachable', 'nothing-crawlable']);
  if (findings.some((f) => fatal.has(f.id)) || !pages) {
    return {
      score: null,
      grade: null,
      why: findings.some((f) => fatal.has(f.id))
        ? 'The crawl never got a page to check, so there is nothing to score.'
        : 'No pages were crawled.',
    };
  }

  // How many distinct pages each check is on. Distinct, because one page can
  // trip a check several times — nine images with no alt on one page is one
  // page failing the alt check, not nine.
  const hitPages = new Map();
  const hitLevel = new Map();
  for (const finding of findings) {
    if (!CHECKLIST[finding.id]) continue;
    const seen = hitPages.get(finding.id) ?? new Set();
    seen.add(finding.url ?? '');
    hitPages.set(finding.id, seen);
    if (finding.level === 'error') hitLevel.set(finding.id, 'error');
    else if (!hitLevel.has(finding.id)) hitLevel.set(finding.id, finding.level);
  }

  const rows = [];
  for (const [id, check] of Object.entries(CHECKLIST)) {
    const fired = hitPages.has(id);
    if (!applies(check, applicable, fired)) {
      rows.push({ id, check, state: 'skipped' });
      continue;
    }
    const on = hitPages.get(id)?.size ?? 0;
    // A site check is one yes or no. A page check costs its share of the
    // crawl, and a check that somehow named more pages than were crawled is
    // clamped rather than allowed to cost more than it can.
    const spread = check.scope === 'site' ? (on ? 1 : 0) : Math.min(1, on / pages);
    rows.push({
      id,
      check,
      state: on ? 'failed' : 'passed',
      pages: on,
      spread,
      cost: round(WEIGHT[check.worst] * spread),
      level: hitLevel.get(id) ?? check.worst,
    });
  }

  const scored = rows.filter((r) => r.state !== 'skipped');
  if (!scored.length) {
    return { score: null, grade: null, why: 'No check in the list applied to this run.' };
  }

  const spent = scored.reduce((sum, r) => sum + r.cost, 0);
  // Floored at zero rather than allowed to go negative: below nothing there is
  // no more information, and "−40" reads as a number somebody can compare.
  const score = Math.max(0, Math.round(100 - spent));

  // The same sum with the error-level checks clean and the warnings left
  // exactly where they are. Not a prediction — it is what "fix the errors
  // first" is worth, in the same points as the score itself.
  const warnCost = scored
    .filter((r) => r.check.worst !== 'error')
    .reduce((sum, r) => sum + r.cost, 0);

  const failed = rows
    .filter((r) => r.state === 'failed')
    .map((r) => ({
      id: r.id,
      area: categoryOf(r.id),
      level: r.level,
      worst: r.check.worst,
      pages: r.pages,
      scope: r.check.scope,
      // What this check is taking off the score, and therefore what fixing it
      // is worth. The one number that turns a list of problems into an order
      // to do them in.
      cost: r.cost,
    }))
    .sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));

  const passed = rows
    .filter((r) => r.state === 'passed')
    .map((r) => ({ id: r.id, area: categoryOf(r.id), pass: r.check.pass, worst: r.check.worst }));

  const skipped = rows
    .filter((r) => r.state === 'skipped')
    .map((r) => ({
      id: r.id,
      area: categoryOf(r.id),
      pass: r.check.pass,
      why: WHY_SKIPPED[r.check.needs] ?? 'Not applicable to this run.',
    }));

  return {
    score,
    grade: gradeOf(score),
    ifErrorsFixed: Math.max(0, Math.round(100 - warnCost)),
    // What the score paid out, so the arithmetic can be checked rather than
    // taken on trust.
    lost: round(spent),
    checks: { passed: passed.length, failed: failed.length, skipped: skipped.length },
    weights: WEIGHT,
    passed,
    failed,
    skipped,
    areas: areaScores(rows),
  };
}

/** One decimal. A cost of 0.06 rounds to 0.1 rather than to nothing, so a
 *  check that is taking points off never prints as free. */
const round = (n) => (n > 0 && n < 0.1 ? 0.1 : Math.round(n * 10) / 10);

/** Why a check was left out of the sum, said in a sentence rather than left as
 *  a key. A reader is entitled to know what the score did not look at. */
const WHY_SKIPPED = {
  images: 'No page carries an image.',
  hreflang: 'No page declares hreflang.',
  jsonld: 'No page carries structured data.',
  expect: 'No schema expectations are configured.',
  psi: 'PageSpeed was not asked — run with --psi.',
  psiField: 'Google has no real-visitor data for these pages yet.',
  redirects: 'No redirect map was given — run with --redirects.',
  external: 'Outbound links were not checked — run with --check-external.',
  sitemap: 'No sitemap was found.',
  https: 'The site is not served over HTTPS.',
  tls: 'The certificate could not be read from this runtime.',
  multipage: 'Only one page was crawled.',
  llmsTxt: 'The site serves no llms.txt, so there is nothing for robots.txt to contradict.',
  fingerprints: 'No page marks its content region, so pages cannot be compared.',
  ogImage: 'No page declares an og:image.',
  twitterImage: 'No page declares a twitter:image of its own.',
  compareAs: 'The pages were not fetched a second time — run with --compare-as.',
};

/** The same sum, once per area, so "where is this site weak" is answerable
 *  without reading the list. Areas with nothing applicable are absent rather
 *  than shown at 100, which would read as a clean bill of health. */
function areaScores(rows) {
  const out = [];
  for (const name of [...CATEGORIES, 'Other']) {
    const mine = rows.filter((r) => r.state !== 'skipped' && categoryOf(r.id) === name);
    if (!mine.length) continue;
    out.push({
      name,
      // Points this area is taking off the whole score, not a score of its
      // own out of 100: an area's share of a hundred-point sheet is not a
      // hundred-point sheet itself, and printing it as one would invite
      // "Content: 88" to be read as a grade for the writing.
      lost: round(mine.reduce((sum, r) => sum + r.cost, 0)),
      passed: mine.filter((r) => r.state === 'passed').length,
      failed: mine.filter((r) => r.state === 'failed').length,
    });
  }
  return out.sort((a, b) => b.lost - a.lost || a.name.localeCompare(b.name));
}
