// End to end against a fixture site on localhost: sitemap discovery, the
// crawl, every check, and the reports. No network, nothing that can change
// underneath the assertions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureSite } from './server.mjs';
import { audit } from '../src/audit.mjs';
import { markdown, html } from '../src/report.mjs';

let site;
let result;

before(async () => {
  site = await startFixtureSite();
  result = await audit(site.origin, { concurrency: 2 });
});
after(() => site.stop());

const ids = () => result.findings.map((f) => f.id);
const forUrl = (path) =>
  result.findings.filter((f) => f.url === `${site.origin}${path}`).map((f) => f.id);

test('the sitemap is discovered through robots.txt', () => {
  assert.equal(result.meta.pages, 4);
  assert.match(result.meta.sitemap, /sitemap\.xml$/);
});

test('a noindexed page listed in the sitemap is an error', () => {
  assert.ok(forUrl('/hidden/').includes('noindex'));
});

test('the broken internal link is found by the site-wide sweep', () => {
  const broken = result.findings.filter((f) => f.id === 'broken-link');
  assert.equal(broken.length, 1);
  assert.match(broken[0].detail, /\/gone\//);
});

test('the second h1 on /about/ is reported', () => {
  assert.ok(forUrl('/about/').includes('h1-multiple'));
});

test('the image with no alt on /about/ is reported, the described one is not', () => {
  assert.ok(forUrl('/about/').includes('img-alt'));
  assert.ok(!forUrl('/').includes('img-alt'));
});

test('the WebP og:image on /about/ is flagged', () => {
  assert.ok(forUrl('/about/').includes('og-webp'));
  assert.ok(!forUrl('/').includes('og-webp'));
});

test('the duplicate description shared by / and /about/ is reported once', () => {
  assert.equal(result.findings.filter((f) => f.id === 'duplicate-description').length, 1);
});

test('one-way hreflang between / and /ru/ is reported', () => {
  // The home page points at /ru/, which does not point back.
  assert.ok(ids().includes('hreflang-one-way'));
});

test('missing llms.txt is a note, not a failure', () => {
  const llms = result.findings.find((f) => f.id === 'llms-missing');
  assert.equal(llms.level, 'info');
});

test('the fixture has no false positives on the pages that are correct', () => {
  // The home page is deliberately sound apart from being thin and linking to
  // a missing page — neither of which is attributed to the page's own markup.
  const home = forUrl('/');
  for (const id of ['title-missing', 'h1-missing', 'canonical-missing', 'viewport-missing', 'lang-missing', 'og-webp']) {
    assert.ok(!home.includes(id), `unexpected ${id} on the home page`);
  }
});

test('ignore rules from config remove findings and are counted', async () => {
  const filtered = await audit(site.origin, {
    concurrency: 2,
    ignore: [{ id: 'thin-content' }],
  });
  assert.ok(!filtered.findings.some((f) => f.id === 'thin-content'));
  assert.ok(filtered.meta.ignored > 0);
});

test('schema expectations run against the crawled pages', async () => {
  const expected = await audit(site.origin, {
    concurrency: 2,
    expect: [{ urls: ['/'], types: ['Organization'] }],
  });
  const finding = expected.findings.find((f) => f.id === 'schema-expected');
  assert.ok(finding, 'expected a schema-expected finding');
  assert.match(finding.detail, /WebSite/); // reports what the page does declare
});

test('both report formats render the run without throwing', () => {
  const md = markdown(result.findings, result.meta);
  const page = html(result.findings, result.meta);
  assert.ok(md.includes('# SEO audit'));
  assert.ok(page.startsWith('<!doctype html>'));
  assert.ok(page.includes(site.origin));
});

test('a site with no sitemap says so instead of crashing', async () => {
  const empty = await audit('http://127.0.0.1:1/', { concurrency: 1 });
  assert.deepEqual(empty.findings.map((f) => f.id), ['no-sitemap']);
  assert.equal(empty.meta.pages, 0);
});
