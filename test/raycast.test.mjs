// The Raycast extension, minus its components.
//
// `raycast/lib/present.mjs` holds everything the commands do that is not React,
// precisely so it can be run here. The components are thin over it; the parts
// that can be wrong quietly — a preference that parses to NaN pages, a library
// row pointing at a file that is gone, a refusal shown as a result — are all in
// the tested half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

import {
  SPEEDS, crawlOptions, normalise, previewRows, causeRows, summaryLine, keptReports, readReport,
} from '../raycast/lib/present.mjs';

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
