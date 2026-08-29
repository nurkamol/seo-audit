// The Raycast extension, minus its components.
//
// `raycast/lib/present.mjs` holds everything the commands do that is not React,
// precisely so it can be run here. The components are thin over it; the parts
// that can be wrong quietly — a preference that parses to NaN pages, a library
// row pointing at a file that is gone, a refusal shown as a result — are all in
// the tested half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** A repo file, as text. The manifest and the module that reads it are checked
 *  against each other, so both have to be read from disk rather than imported. */
const read = (rel) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
import { join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

import {
  SPEEDS, crawlOptions, normalise, previewRows, causeRows, summaryLine, keptReports, readReport,
  scoreTag, scoreLine, gainFor, passedRows, skippedRows,
} from '../raycast/lib/present.mjs';
import { FORMATS, filenameFor, render } from '../raycast/lib/exports.mjs';
import { BROWSER_NAMES, OS_NAMES } from '../src/agents.mjs';

test('preferences arrive as strings, and nonsense is the default rather than NaN', () => {
  assert.deepEqual(crawlOptions({ limit: '40', speed: 'gentle', checkExternal: true }),
    { limit: 40, concurrency: 1, checkExternal: true });

  // Raycast hands back "" for a cleared text field, and somebody will type a
  // word into it. Neither is a page count.
  assert.equal(crawlOptions({}).limit, 25);
  assert.equal(crawlOptions({ limit: '' }).limit, 25);
  assert.equal(crawlOptions({ limit: 'banana' }).limit, 25);
  assert.equal(crawlOptions({ limit: '-5' }).limit, 25);
  // A launcher is a poor place to wait out a crawl, but the ceiling is the
  // engine's, not an opinion invented here.
  assert.equal(crawlOptions({ limit: '99999' }).limit, 5000);

  assert.equal(crawlOptions({}).concurrency, SPEEDS.normal);
  assert.equal(crawlOptions({ speed: 'nonsense' }).concurrency, SPEEDS.normal);
  assert.equal(crawlOptions({ speed: 'fast' }).concurrency, 12);
  // A checkbox that is absent is not a checkbox that is on.
  assert.equal(crawlOptions({}).checkExternal, false);
});

test('Search Console is off unless asked for, and a property is optional', () => {
  // The checkbox is the switch and the textfield is the property, the same
  // shape --search-console has: bare means the site being crawled, a value
  // names a property. The engine reads `true` and a string differently, so
  // this must send exactly one of them.
  assert.equal(crawlOptions({}).searchConsole, undefined, 'off unless asked');
  assert.equal(crawlOptions({ searchConsole: true }).searchConsole, true,
    'on with no property asks about the site being crawled');
  assert.equal(
    crawlOptions({ searchConsole: true, searchConsoleProperty: '  sc-domain:x.test  ' }).searchConsole,
    'sc-domain:x.test',
    'a property is trimmed and passed through',
  );
  // A property typed with the switch off does nothing, which is why the
  // preference says "When Ask Search Console is on" — the same wording the
  // performance sample field uses for the same reason.
  assert.equal(
    crawlOptions({ searchConsoleProperty: 'sc-domain:x.test' }).searchConsole,
    undefined,
  );
  // An empty or blank property is not a property, and must not reach the
  // engine as the empty string — `typeof === 'string'` is how it decides.
  assert.equal(crawlOptions({ searchConsole: true, searchConsoleProperty: '   ' }).searchConsole, true);
});

test('every Search Console preference the extension reads is declared', () => {
  // A preference the code reads and the manifest never declares is a control
  // nobody can reach; one declared and never read is a control that does
  // nothing. Both are silent, so both are checked.
  const manifest = JSON.parse(read('raycast/package.json'));
  const declared = new Set(manifest.preferences.map((p) => p.name));
  for (const name of ['searchConsole', 'searchConsoleProperty']) {
    assert.ok(declared.has(name), `${name} is read by crawlOptions but not declared`);
  }
  const source = read('raycast/lib/present.mjs');
  for (const name of [...declared].filter((n) => n.startsWith('searchConsole'))) {
    assert.match(source, new RegExp(`preferences\\.${name}\\b`),
      `${name} is declared but crawlOptions never reads it`);
  }
});

test('what somebody types is accepted exactly as the macOS app accepts it', () => {
  assert.equal(normalise('example.com'), 'https://example.com');
  assert.equal(normalise('  example.com  '), 'https://example.com');
  assert.equal(normalise('http://example.com'), 'http://example.com');
  assert.equal(normalise('https://example.com/blog'), 'https://example.com/blog');

  // No dot, no host. "localhost" would be a fair thing to want one day;
  // silently auditing nothing is not.
  assert.equal(normalise('nonsense'), null);
  assert.equal(normalise(''), null);
  assert.equal(normalise('   '), null);
  assert.equal(normalise(undefined), null);
});

test('a preview that cannot answer says so instead of showing an empty list', () => {
  const limited = previewRows({ reachable: false, rateLimited: true, origin: 'https://x.test' });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].tone, 'error');
  assert.match(limited[0].title, /429/);
  assert.match(limited[0].subtitle, /Gentle/, 'and says what to do about it');

  const dead = previewRows({ reachable: false, rateLimited: false, origin: 'https://x.test' });
  assert.match(dead[0].title, /Nothing answered/);

  assert.deepEqual(previewRows(null), [], 'nothing yet is not a row saying nothing');
});

test('a preview shows the counts, the shape of the site, and what it cost', () => {
  const rows = previewRows({
    reachable: true, origin: 'https://x.test', sitemap: 'https://x.test/sitemap.xml',
    listed: 210, wouldCheck: 25, skippedByLimit: 185, limit: 25, requests: 3, ms: 1300,
    sections: [{ path: '/docs/', count: 35 }, { path: '/news/', count: 18 }],
  });

  assert.match(rows[0].title, /210 URLs listed/);
  assert.match(rows[0].subtitle, /25 would be checked/);
  assert.match(rows[0].subtitle, /185 past the limit/);
  assert.equal(rows[0].tone, 'warn', 'a limit that cuts most of the site is worth noticing');

  assert.deepEqual(rows.slice(1, 3).map((r) => r.title), ['/docs/', '/news/']);

  const cost = rows.at(-1);
  assert.match(cost.title, /3 requests/);
  assert.match(cost.subtitle, /No page was fetched/);
});

test('a site with no sitemap is told, not given a made-up number', () => {
  const rows = previewRows({ reachable: true, origin: 'https://x.test', sitemap: null, listed: 0,
    wouldCheck: null, skippedByLimit: 0, limit: 25, requests: 3, ms: 900, sections: [] });
  assert.equal(rows[0].tone, 'warn');
  assert.match(rows[0].title, /No sitemap/);
  assert.match(rows[0].subtitle, /up to 25 pages/);
});

test('causes are shown in the engine order, with the engine areas', () => {
  const report = {
    meta: { pages: 10 },
    findings: [{ level: 'error', id: 'a', title: 'T', detail: 'd', url: 'https://x.test/1' }],
    causes: [
      { id: 'h1-missing', title: 'No <h1>', level: 'error', section: '/', scope: 'once',
        area: 'Content', pages: ['https://x.test/1'] },
      { id: 'desc-long', title: 'Cut off', level: 'warn', section: '/docs/', scope: '3 pages',
        area: 'Content', pages: ['https://x.test/2'] },
    ],
  };
  const rows = causeRows(report);
  assert.deepEqual(rows.map((r) => r.title), ['No <h1>', 'Cut off'], 'the order is not re-sorted here');
  assert.equal(rows[0].area, 'Content');
  assert.equal(rows[0].checkId, 'h1-missing');
  // Two causes of one check under two sections must not collide as one row.
  assert.equal(new Set(rows.map((r) => r.id)).size, 2);
  assert.deepEqual(causeRows(null), []);
});

test('a summary never leaves out what was silenced', () => {
  const base = { meta: { pages: 10 }, findings: [
    { level: 'error', id: 'a' }, { level: 'warn', id: 'b' },
  ], causes: [{ id: 'a' }] };

  assert.match(summaryLine(base), /10 pages · 2 findings · 1 thing to change/);
  assert.match(summaryLine(base), /1 error/);

  // The one that matters: a check somebody quietened must not read the same as
  // a check that passed.
  assert.match(summaryLine({ ...base, meta: { pages: 10, ignored: 4 } }), /4 silenced/);
  assert.ok(!summaryLine(base).includes('silenced'), 'and it is absent when nothing was');
});

test('a kept report whose file is gone is not offered', () => {
  const root = mkdtempSync(join(tmpdir(), 'seo-audit-raycast-'));
  try {
    mkdirSync(join(root, 'reports'), { recursive: true });
    const here = '11111111-1111-1111-1111-111111111111';
    const gone = '22222222-2222-2222-2222-222222222222';
    writeFileSync(join(root, 'reports', `${here}.json`),
      JSON.stringify({ meta: { pages: 3 }, findings: [], causes: [] }));
    writeFileSync(join(root, 'index.json'), JSON.stringify([
      { id: gone, host: 'gone.test', pages: 1, causes: 1, errors: 0, finishedAt: '2026-08-24T00:00:00Z' },
      { id: here, host: 'here.test', pages: 3, causes: 2, errors: 0, finishedAt: '2026-08-23T00:00:00Z' },
    ]));

    const rows = keptReports(root);
    assert.deepEqual(rows.map((r) => r.host), ['here.test'],
      'a row that opens onto nothing is worse than no row');
    assert.ok(readReport(rows[0].path), 'and the one that is listed reads back');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a library that is missing, empty or corrupt is no reports rather than a crash', () => {
  const root = mkdtempSync(join(tmpdir(), 'seo-audit-raycast-'));
  try {
    assert.deepEqual(keptReports(join(root, 'nothing-here')), []);

    writeFileSync(join(root, 'index.json'), 'not json at all');
    assert.deepEqual(keptReports(root), []);

    writeFileSync(join(root, 'index.json'), '{"not":"an array"}');
    assert.deepEqual(keptReports(root), []);

    assert.equal(readReport(join(root, 'missing.json')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gentle means the same number of connections in both windows', () => {
  // The one thing this extension duplicates. `CrawlSettings.Speed` in Swift and
  // `SPEEDS` here are two lists of the same three numbers, and two people
  // reading "Gentle" in two places should get the same crawl. Everything else
  // the extension knows it gets from the engine; this is the exception, so it
  // is the thing that needs a guard.
  const swift = readFileSync(join(root, 'mac/SeoAudit/CrawlSettings.swift'), 'utf8');
  const block = swift.slice(swift.indexOf('var connections: Int'));
  const found = Object.fromEntries(
    [...block.slice(0, 240).matchAll(/case \.(gentle|normal|fast):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
  );

  assert.deepEqual(found, SPEEDS,
    'raycast/lib/present.mjs and CrawlSettings.swift disagree about what Gentle, Normal and Fast mean');
});

test('a stored report from before areas travelled with it still groups properly', () => {
  // A report kept before 1.24.0 has causes without an `area`. Defaulting those
  // to "Other" put every finding in one bucket — including no-editorial-links,
  // which has been in Links the whole time. The engine knows; ask it.
  const old = {
    meta: { pages: 3 },
    findings: [],
    causes: [
      { id: 'no-editorial-links', title: 'No links inside the content', level: 'info',
        section: '/', scope: 'once', pages: ['https://x.test/'] },
      { id: 'tls-not-checked', title: 'Certificate expiry was not checked', level: 'info',
        section: '/', scope: 'once', pages: ['https://x.test/'] },
    ],
  };
  const rows = causeRows(old);
  assert.deepEqual(rows.map((r) => r.area), ['Links', 'Site & security'],
    'the area comes from the engine when the file does not carry one');

  // And a report that does carry one is taken at its word rather than
  // recomputed, so a future area never silently disagrees with a stored one.
  const carried = causeRows({ causes: [{ ...old.causes[0], area: 'Content' }] });
  assert.equal(carried[0].area, 'Content');
});

test('every preference reaches the engine, and defaults are left out', () => {
  // Left out rather than sent explicitly: the engine's defaults stay written
  // down in the engine, and an option that is present is one somebody chose.
  assert.deepEqual(Object.keys(crawlOptions({})).sort(),
    ['checkExternal', 'concurrency', 'limit']);

  const all = crawlOptions({
    limit: '40', speed: 'gentle', checkExternal: true,
    sitemap: '/sitemaps/all.xml',
    exclude: '/tag/**, /page/*\n/collections/*/products/*',
    since: '2026-08-17',
    ignore: 'thin-content, img-srcset',
    browser: 'googlebot', os: 'macos',
    performance: 'sample', performanceSample: '5', performanceDesktop: true,
  });

  assert.equal(all.limit, 40);
  assert.equal(all.concurrency, 1);
  assert.equal(all.sitemap, '/sitemaps/all.xml');
  assert.deepEqual(all.exclude, ['/tag/**', '/page/*', '/collections/*/products/*'],
    'commas and newlines both separate, because both are what people type');
  assert.equal(all.since, '2026-08-17');
  assert.deepEqual(all.ignore, ['thin-content', 'img-srcset']);
  assert.match(all.userAgent, /Googlebot/);
  assert.deepEqual(all.psi, ['/**']);
  assert.equal(all.psiSample, 5);
  assert.equal(all.psiStrategy, 'desktop');
});

test('a user agent of your own wins, and the home page needs no sample', () => {
  const own = crawlOptions({ userAgent: '  MyBot/1.0  ', browser: 'chrome', os: 'macos' });
  assert.equal(own.userAgent, 'MyBot/1.0', 'trimmed, and the menus are not consulted');

  const home = crawlOptions({ performance: 'homepage' });
  assert.deepEqual(home.psi, ['/']);
  assert.equal(home.psiSample, undefined, 'one page is not a sample');
  assert.equal(home.psiStrategy, 'mobile', 'which is what Google indexes with');

  // A combination that cannot exist is refused by the engine, and a refusal is
  // not a reason to fail the run.
  assert.equal(crawlOptions({ browser: 'safari', os: 'windows' }).userAgent, undefined);
});

test('the browser and system menus are the engine’s lists, not a copy', () => {
  // A dropdown in a static manifest cannot read agents.mjs at runtime, so this
  // is the one other thing the extension duplicates. Guarded like SPEEDS is.
  const manifest = JSON.parse(readFileSync(join(root, 'raycast/package.json'), 'utf8'));
  const values = (name) =>
    manifest.preferences.find((p) => p.name === name).data
      .map((d) => d.value)
      .filter(Boolean);

  assert.deepEqual(values('browser'), BROWSER_NAMES,
    'raycast/package.json and src/agents.mjs disagree about the browsers');
  assert.deepEqual(values('os'), OS_NAMES,
    'raycast/package.json and src/agents.mjs disagree about the systems');
});

test('a report is written in every format the engine can write', () => {
  const report = {
    meta: { origin: 'https://x.test', pages: 2, date: '2026-08-24' },
    findings: [{ level: 'warn', id: 'a', title: 'T', detail: 'D', url: 'https://x.test/1' }],
    causes: [],
  };

  assert.deepEqual(FORMATS.map((f) => f.id), ['html', 'markdown', 'csv', 'json', 'sitemap', 'llms', 'schema']);
  for (const format of ['html', 'markdown', 'csv', 'json']) {
    const { text, refused } = render(format, report);
    assert.equal(refused, null, `${format} should write`);
    assert.ok(text.length > 50, `${format} wrote almost nothing`);
  }
  assert.match(render('html', report).text, /^<!doctype html>/i);
  assert.match(render('json', report).text, /"findings"/);

  // A name somebody can find again, and that sorts.
  assert.equal(filenameFor('csv', 'jekyllrb.com', new Date('2026-08-24T10:00:00Z')),
    'seo-audit-jekyllrb.com-2026-08-24.csv');
  assert.match(filenameFor('html', 'a site/with slashes'), /^seo-audit-a-site-with-slashes-/);
});

test('a sitemap the engine refused to build carries the refusal, not an empty file', () => {
  const base = { meta: { origin: 'https://x.test', pages: 2 }, findings: [], causes: [] };

  // Never asked for.
  assert.match(render('sitemap', base).refused, /did not build one/);

  // Asked for and refused — a sitemap missing real pages is worse than one
  // listing dead ones, so the reason travels instead of a file.
  const refused = render('sitemap', {
    ...base,
    sitemap: { xml: null, urls: [], added: [], refused: 'The crawl stopped at its limit.' },
  });
  assert.equal(refused.text, null);
  assert.match(refused.refused, /stopped at its limit/);

  const written = render('sitemap', {
    ...base,
    sitemap: { xml: '<?xml version="1.0"?>', urls: ['https://x.test/'], added: [], refused: null },
  });
  assert.match(written.text, /^<\?xml/);
  assert.equal(written.refused, null);
});

// A Store submission is `extensions/seo-audit/` and nothing above it. Every
// import that climbs out of the folder builds here, because the repository is
// around it, and fails there — which is how this shipped broken once. The
// extension depends on the engine as a package instead, and this is the guard.
test('the extension imports nothing above its own folder', () => {
  const root = new URL('../raycast/', import.meta.url);
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === 'node_modules' || entry.name === 'dist') return [];
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      return entry.isDirectory() ? walk(child) : [child];
    });

  const sources = walk(root).filter((url) => /\.(m?[jt]sx?|d\.mts)$/.test(url.pathname));
  assert.ok(sources.length > 5, 'found no extension sources to check');

  for (const url of sources) {
    const source = readFileSync(url, 'utf8');
    for (const [, specifier] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(
        !specifier.startsWith('../..'),
        `${url.pathname.split('/raycast/')[1]} imports ${specifier}, which is outside the extension`,
      );
    }
  }

  // And what it imports instead has to be declared, or the Store's install
  // resolves nothing. The name is read rather than written down: it changed
  // once already, when npm refused `seo-audit` as too close to an abandoned
  // `seoaudit`, and a hardcoded copy here would have passed while the extension
  // installed nothing.
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const engine = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.dependencies[engine.name], `the extension must depend on ${engine.name}`);
});

// The `exports` map is the contract the extension installs against: a subpath
// dropped from it is a front end that stops building, and nothing in this
// repository would notice, because the symlink resolves the same paths.
test('every engine subpath the extension imports is exported', async () => {
  const engine = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const exported = new Set(
    Object.keys(engine.exports).map((key) => key.replace(/^\./, engine.name)),
  );

  const used = new Set();
  const dir = new URL('../raycast/lib/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    for (const [, specifier] of source.matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) {
      if (specifier === engine.name || specifier.startsWith(engine.name + '/')) used.add(specifier);
    }
  }

  assert.ok(used.size > 0, 'found no engine imports at all');
  for (const specifier of used) {
    assert.ok(exported.has(specifier), `${specifier} is imported but not in "exports"`);
    // Exported is not the same as resolvable — a path can be listed and gone.
    await import(specifier);
  }
});

// Every preference the manifest declares has to be read by `crawlOptions()`.
//
// TypeScript cannot check this half: `present.mjs` is plain ESM on purpose, so
// `node --test` can run it, and a preference nothing reads is a setting that
// silently does nothing — the same failure `src/options.mjs` exists to prevent
// for the macOS window. It has already happened once here in the other
// direction: the hand-written `Preferences` type listed three of thirteen.
test('every preference the manifest declares is read, and no others', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../raycast/package.json', import.meta.url), 'utf8'),
  );
  const declared = new Set([
    ...(manifest.preferences ?? []).map((p) => p.name),
    ...manifest.commands.flatMap((c) => (c.preferences ?? []).map((p) => p.name)),
  ]);

  const source = readFileSync(
    new URL('../raycast/lib/present.mjs', import.meta.url),
    'utf8',
  );
  const body = source.slice(source.indexOf('export function crawlOptions'));
  const read = new Set(
    [...body.matchAll(/\bpreferences\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]),
  );

  assert.ok(declared.size > 5, 'found no declared preferences to check');

  for (const name of declared) {
    assert.ok(read.has(name), `the manifest declares "${name}" and nothing reads it`);
  }
  for (const name of read) {
    assert.ok(declared.has(name), `crawlOptions reads "${name}", which the manifest does not declare`);
  }
});

// README images live in media/, never in metadata/.
//
// `metadata/` is the Store's screenshot gallery and nothing else; the
// guidelines say linked media goes in a top-level `media` folder, and the
// submission checklist asks you to confirm it. Ours pointed at `metadata/` with
// that box ticked, which is the worst version of the mistake: not noticed, and
// asserted as checked.
test('the extension README links no image inside metadata/', () => {
  const root = new URL('../raycast/', import.meta.url);
  const readme = readFileSync(new URL('README.md', root), 'utf8');

  const linked = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(linked.length > 0, 'found no images in the README to check');

  for (const path of linked) {
    assert.ok(
      !path.startsWith('metadata/'),
      `README links ${path}; linked media belongs in media/, not the Store gallery`,
    );
    if (!/^https?:/.test(path)) {
      // A link to a file that is not there renders as a broken image on the
      // Store page, which nothing else here would catch.
      assert.ok(existsSync(new URL(path, root)), `README links ${path}, which does not exist`);
    }
  }

  // Paths named in prose rot the same way — `lib/seo-audit.d.ts` outlived the
  // file by a rename, and the README is the Store page, so a reader's first
  // impression was a filename that is not there.
  for (const [, named] of readme.matchAll(/`((?:lib|src|assets|media|metadata)\/[\w./-]+)`/g)) {
    assert.ok(existsSync(new URL(named, root)), `README names ${named}, which does not exist`);
  }
});

// --- the score, as rows ----------------------------------------------------
// None of these numbers are decided here. `scoreRun()` in src/score.mjs works
// out what a check costs and what applied; this half arranges the answer, and
// what can go wrong quietly is a report kept before scoring existed being shown
// as a zero rather than as nothing.

test('a report with no score shows no score rather than a zero', () => {
  assert.equal(scoreTag(undefined), null);
  assert.equal(scoreTag(null), null);
  assert.equal(scoreTag({ why: 'The crawl never got a page to check.' }), null);
  assert.equal(scoreLine({ why: 'The crawl never got a page to check.' }),
    'The crawl never got a page to check.');
});

test('the score tag carries the grade and the line carries the arithmetic', () => {
  const score = {
    score: 74, grade: 'C', lost: 26.1, ifErrorsFixed: 88,
    checks: { passed: 61, failed: 9, skipped: 22 },
  };
  assert.equal(scoreTag(score), '74/100 C');
  const line = scoreLine(score);
  assert.match(line, /26.1 points across 9 checks/);
  assert.match(line, /61 passed/);
  // Never left out: a check nobody could run must not read as one that passed.
  assert.match(line, /22 did not apply/);
  assert.match(line, /errors cleared → 88/);
});

// A check can be a cause under two sections, and giving each the whole check's
// cost would say the site can gain the same points twice.
test('a cause gets its share of what its check is costing', () => {
  const score = { failed: [{ id: 'h1-missing', cost: 4, pages: 20, area: 'Content', level: 'warn' }] };
  assert.equal(gainFor({ checkId: 'h1-missing', pages: Array(20).fill('u') }, score), 4);
  assert.equal(gainFor({ checkId: 'h1-missing', pages: Array(5).fill('u') }, score), 1);
  assert.equal(gainFor({ checkId: 'title-missing', pages: ['u'] }, score), null);
  // A note costs the score nothing, so there is nothing to gain and no badge.
  assert.equal(gainFor({ checkId: 'llms-missing', pages: ['u'] }, { failed: [] }), null);
});

test('what passed is listed, and what was skipped is grouped by its reason', () => {
  const score = {
    passed: [{ id: 'title-missing', area: 'Content', pass: 'Every page has a title' }],
    skipped: [
      { id: 'hreflang-dead', area: 'Multilingual', pass: 'x', why: 'No page declares hreflang.' },
      { id: 'hreflang-one-way', area: 'Multilingual', pass: 'x', why: 'No page declares hreflang.' },
      { id: 'psi-score', area: 'Performance', pass: 'x', why: 'PageSpeed was not asked — run with --psi.' },
    ],
  };
  assert.deepEqual(passedRows(score).map((r) => r.title), ['Every page has a title']);

  const skipped = skippedRows(score);
  assert.equal(skipped.length, 2, 'one row per reason, not one per check');
  assert.equal(skipped[0].title, 'No page declares hreflang.');
  assert.equal(skipped[0].subtitle, 'hreflang-dead, hreflang-one-way');

  assert.deepEqual(passedRows(undefined), []);
  assert.deepEqual(skippedRows(undefined), []);
});

// The extension's exports call the engine's writers, and until the score was
// passed through they wrote a report without one while the list beside them
// showed a number. The same gap the macOS window had.
test('an exported report carries the score the list is showing', () => {
  const report = {
    meta: { origin: 'https://x.test', pages: 4, date: '2026-01-01' },
    findings: [{ level: 'warn', id: 'desc-missing', title: 'No description', detail: 'x', url: 'https://x.test/a' }],
    score: {
      score: 74, grade: 'C', lost: 26, ifErrorsFixed: 74,
      checks: { passed: 2, failed: 1, skipped: 0 },
      failed: [{ id: 'desc-missing', area: 'Content', level: 'warn', pages: 1, cost: 1 }],
      passed: [{ id: 'title-missing', area: 'Content', pass: 'Every page has a title' }],
      skipped: [],
      areas: [{ name: 'Content', lost: 1, passed: 1, failed: 1 }],
    },
  };

  assert.match(render('markdown', report).text, /## Score: 74\/100 \(C\)/);
  assert.match(render('html', report).text, /Score 74 out of 100/);
  assert.match(render('csv', report).text, /"pass","title-missing"/);

  // And a report kept before scoring existed still writes, without one.
  const older = { meta: report.meta, findings: report.findings };
  assert.doesNotMatch(render('markdown', older).text, /## Score/);
  assert.ok(render('html', older).text.length > 0);
});

// The same arrangement as the sitemap, and the same reason: a file built from a
// fraction of a site looks complete, so the refusal travels instead of a file.
test('an llms.txt the engine refused to build carries the refusal', () => {
  const base = { meta: { origin: 'https://x.test', pages: 2 }, findings: [], causes: [] };
  assert.match(render('llms', base).refused, /did not build one/);

  const refused = render('llms', {
    ...base,
    llms: { text: null, urls: [], sections: 0, refused: 'The crawl stopped at its limit.' },
  });
  assert.equal(refused.text, null);
  assert.match(refused.refused, /stopped at its limit/);

  const written = render('llms', {
    ...base,
    llms: { text: '# x.test\n\n- [Home](https://x.test/)\n', urls: ['https://x.test/'], sections: 1, refused: null },
  });
  assert.equal(written.refused, null);
  assert.match(written.text, /^# x\.test/);
  assert.equal(filenameFor('llms', 'x.test', new Date('2026-08-24T10:00:00Z')), 'seo-audit-x.test-2026-08-24.txt');
});

// The one format whose refusal can be the good answer.
test('a site that already declares everything gets that as the answer', () => {
  const base = { meta: { origin: 'https://x.test', pages: 2 }, findings: [], causes: [] };
  assert.match(render('schema', base).refused, /did not build one/);

  const covered = render('schema', {
    ...base,
    schema: { json: null, generated: [], skipped: { 'already-has-website': 1 },
      refused: 'This site already declares everything that could be written for it.' },
  });
  assert.equal(covered.text, null);
  assert.match(covered.refused, /already declares everything/);

  const written = render('schema', {
    ...base,
    schema: { json: '{"generated":[]}\n', generated: [], skipped: {}, refused: null },
  });
  assert.equal(written.refused, null);
  assert.equal(filenameFor('schema', 'x.test', new Date('2026-08-24T10:00:00Z')), 'seo-audit-x.test-2026-08-24.json');
});
