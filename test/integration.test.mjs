// End to end against a fixture site on localhost: sitemap discovery, the
// crawl, every check, and the reports. No network, nothing that can change
// underneath the assertions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureSite } from './server.mjs';
import { audit, preview } from '../src/audit.mjs';
import { markdown, html } from '../src/report.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('a noindexed page listed in the sitemap is also reported as a sitemap contradiction', () => {
  // /hidden/ is in the fixture's sitemap and carries noindex. The per-page
  // noindex check fires, and so does the one that reads the two files together.
  const finding = result.findings.find((f) => f.id === 'sitemap-not-indexable');
  assert.ok(finding, 'expected the sitemap contradiction to be reported');
  assert.match(finding.detail, /\/hidden\//);
  assert.match(finding.detail, /noindex/);
});

test('a fixture that returns a real 404 is not reported as a soft 404', () => {
  assert.ok(!ids().includes('soft-404'));
});

test('images that the fixture serves are not reported as broken', () => {
  assert.ok(!ids().includes('broken-image'));
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

test('a site that redirects to another host is audited on the host that answers', async () => {
  // Auditing the bare domain of a site that lives at www used to read
  // robots.txt, llms.txt and the security headers off the 301. A store with a
  // good robots.txt was reported as having none.
  const real = await startFixtureSite();
  const front = await startFixtureSite({ withSitemap: false, homeRedirect: `${real.origin}/` });
  try {
    const { findings, meta } = await audit(front.origin, { concurrency: 2 });

    assert.equal(meta.origin, real.origin, 'the audit should move to the host that answers');
    const moved = findings.find((f) => f.id === 'origin-redirected');
    assert.ok(moved, 'and say so');
    assert.equal(moved.level, 'info');
    assert.ok(moved.detail.includes(real.origin));

    // The proof it matters: the real host has a robots.txt and a sitemap, so
    // neither is reported missing even though the host that was asked for has
    // neither.
    assert.ok(!findings.some((f) => f.id === 'robots-missing'), 'robots.txt was read on the right host');
    assert.ok(!findings.some((f) => f.id === 'no-sitemap'));
    assert.ok(meta.pages > 1, 'and the pages came from the real host');
  } finally {
    await front.stop();
    await real.stop();
  }
});

test('a site that stays put is not reported as redirecting', async () => {
  const site = await startFixtureSite();
  try {
    const { findings, meta } = await audit(site.origin, { concurrency: 2 });
    assert.equal(meta.origin, site.origin);
    assert.ok(!findings.some((f) => f.id === 'origin-redirected'));
  } finally {
    await site.stop();
  }
});

test('a site with no sitemap is crawled by following links instead of refused', async () => {
  const bare = await startFixtureSite({ withSitemap: false });
  try {
    const result = await audit(bare.origin, { concurrency: 1 });

    const finding = result.findings.find((f) => f.id === 'no-sitemap');
    assert.ok(finding, 'expected a no-sitemap finding');
    // Still worth saying, but no longer fatal — the pages got audited anyway.
    assert.equal(finding.level, 'warn');
    assert.match(finding.detail, /sitemap\.xml/); // says what it tried
    assert.match(finding.detail, /followed links/);

    // The homepage plus what it links to, rather than nothing at all.
    assert.ok(result.meta.pages > 1, `expected a link crawl, got ${result.meta.pages} pages`);

    // Real checks ran on those pages, which is the whole point.
    const ids = result.findings.map((f) => f.id);
    assert.ok(ids.includes('h1-multiple'), 'expected per-page checks to have run');

    // Nothing is "missing from the sitemap" when there is no sitemap.
    assert.ok(!ids.includes('missing-from-sitemap'));
  } finally {
    await bare.stop();
  }
});

test('--exclude keeps URLs out of the crawl, and always says so', async () => {
  const site = await startFixtureSite();
  try {
    const full = await audit(site.origin, { concurrency: 1 });
    const some = await audit(site.origin, { concurrency: 1, exclude: ['/ru/**'] });

    assert.ok(some.meta.pages < full.meta.pages, 'fewer pages were crawled');
    const note = some.findings.find((f) => f.id === 'excluded');
    assert.ok(note, 'a crawl that quietly shrank is a report about pages nobody looked at');
    assert.equal(note.level, 'info', 'a fact about the run, not a fault of the site');
    assert.match(note.detail, /\/ru\/\*\*/, 'it names the pattern');
    assert.match(note.detail, /not about the site/);

    // Nothing is reported about a page that was never fetched.
    assert.ok(!some.findings.some((f) => (f.url ?? '').includes('/ru/')));
    // And with no patterns there is no note at all.
    assert.ok(!full.findings.some((f) => f.id === 'excluded'));
  } finally {
    await site.stop();
  }
});

test('--since on a sitemap that cannot answer checks everything and says why', async () => {
  // The fixture's sitemap carries no lastmod, which is the common case and the
  // one where guessing would be worst.
  const site = await startFixtureSite();
  try {
    const result = await audit(site.origin, { concurrency: 1, since: '2026-01-01' });
    const refused = result.findings.find((f) => f.id === 'since-not-usable');

    assert.ok(refused, 'it says the filter did not apply');
    assert.equal(refused.level, 'warn');
    assert.match(refused.detail, /lastmod/);
    assert.match(refused.detail, /this report is complete/,
      'and that nothing was silently skipped');
    // The crawl went ahead in full rather than checking nothing.
    assert.ok(result.meta.pages > 1);
    assert.ok(!result.findings.some((f) => f.id === 'since'));
  } finally {
    await site.stop();
  }
});

test('a preview describes the crawl that would happen, and fetches no page', async () => {
  const site = await startFixtureSite();
  try {
    const plan = await preview(site.origin, { concurrency: 1, limit: 2 });

    assert.ok(plan.reachable);
    assert.match(plan.sitemap, /sitemap\.xml$/);
    assert.equal(plan.listed, 4, 'the fixture sitemap lists four URLs');
    assert.equal(plan.wouldCheck, 2, 'and --limit 2 would check two of them');
    assert.equal(plan.skippedByLimit, 2);
    // The whole point: a handful of requests, not one per page.
    assert.ok(plan.requests <= 4, `expected a handful of requests, made ${plan.requests}`);
    assert.equal(plan.sample.length, 4);
  } finally {
    await site.stop();
  }
});

test('a preview of a site with no sitemap says it cannot know how many', async () => {
  // Following links cannot say in advance how many pages it will find, and
  // guessing a number would be worse than saying so.
  const bare = await startFixtureSite({ withSitemap: false });
  try {
    const plan = await preview(bare.origin, { concurrency: 1 });
    assert.equal(plan.sitemap, null);
    assert.equal(plan.listed, 0);
    assert.equal(plan.wouldCheck, null, 'null rather than a made-up count');
    assert.ok(plan.reachable, 'the site answers; it just has no sitemap');
  } finally {
    await bare.stop();
  }
});

test('a rate-limited sitemap probe is not a missing sitemap', async () => {
  // Two runs back to back against one host is enough to trigger this, and the
  // second run said "No sitemap found" about a site whose sitemap the first run
  // had just read. A 429 is the server saying "ask later"; reporting absence
  // from it is a finding about the crawl dressed as a finding about the site.
  const site = await startFixtureSite({ rateLimit: { '/sitemap.xml': 99, '/robots.txt': 99 } });
  try {
    const result = await audit(site.origin, { concurrency: 1 });
    const ids = result.findings.map((f) => f.id);

    assert.ok(!ids.includes('no-sitemap'), 'a 429 does not prove there is no sitemap');
    const finding = result.findings.find((f) => f.id === 'sitemap-not-checked');
    assert.ok(finding, 'expected the run to say it never found out');
    assert.match(finding.detail, /429/);
    assert.match(finding.detail, /not about the site/);
  } finally {
    await site.stop();
  }
});

test('a 404 sitemap is still a missing sitemap', async () => {
  // The half that matters: the fix above must not turn a real absence into a
  // shrug.
  const bare = await startFixtureSite({ withSitemap: false });
  try {
    const result = await audit(bare.origin, { concurrency: 1 });
    const ids = result.findings.map((f) => f.id);
    assert.ok(ids.includes('no-sitemap'));
    assert.ok(!ids.includes('sitemap-not-checked'));
    assert.ok(!ids.includes('crawl-rate-limited'));
  } finally {
    await bare.stop();
  }
});

test('a link crawl follows a redirecting homepage instead of stopping at it', async () => {
  // www.mozilla.org answers 302 to /en-US/. Reading only the first hop finds a
  // redirect with no links in it and concludes the site has one page — which
  // is exactly what this did before the seed was followed.
  const bare = await startFixtureSite({ withSitemap: false, homeRedirect: '/about/' });
  try {
    const result = await audit(bare.origin, { concurrency: 1 });
    // Before the seed was followed this produced nothing-crawlable and no
    // audited pages at all.
    assert.ok(!result.findings.some((f) => f.id === 'nothing-crawlable'));
    assert.equal(result.meta.pages, 1);
    // The page it landed on was parsed and checked, rather than the redirect
    // being recorded as a contentless page. (/about/ links only to itself, so
    // one page is the whole reachable set here.)
    assert.ok(result.findings.some((f) => f.id === 'h1-multiple'));
    assert.ok(result.findings.some((f) => (f.url ?? '').endsWith('/about/')));
  } finally {
    await bare.stop();
  }
});

test('a link crawl obeys robots.txt rather than helping itself', async () => {
  const bare = await startFixtureSite({ withSitemap: false, disallow: '/hidden/' });
  try {
    const result = await audit(bare.origin, { concurrency: 1 });
    const crawled = result.findings.map((f) => f.url ?? '');
    assert.ok(
      !crawled.some((u) => u.includes('/hidden/')),
      'a disallowed path should not be crawled',
    );
  } finally {
    await bare.stop();
  }
});

test('the bare command never waits for input when nothing is a terminal', async () => {
  // The property that matters more than the prompt itself: in CI, in a pipe,
  // or under a task runner, this has to print help and leave rather than block
  // a build forever waiting for a URL nobody can type.
  const { execFile } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'seo-audit.mjs');

  const { code, stdout } = await new Promise((resolve) => {
    const child = execFile(process.execPath, [bin], { timeout: 10000 }, (err, stdout) =>
      resolve({ code: err?.code ?? 0, stdout }),
    );
    child.stdin.end(); // not a TTY, and closed
  });

  assert.equal(code, 2, 'expected the help exit code, not a hang');
  assert.match(stdout, /Usage/);
});

test('a host that never answers is reported as unreachable, not as missing a sitemap', async () => {
  // Nothing listens on port 1. A refused connection is not a sitemap problem,
  // and calling it one sends people looking in the wrong place.
  const dead = await audit('http://127.0.0.1:1/', { concurrency: 1 });
  assert.deepEqual(dead.findings.map((f) => f.id), ['unreachable']);
  assert.match(dead.findings[0].detail, /bot-protection|not answering|no response/i);
});

test('a dead host with an expired certificate is told what is actually wrong', async () => {
  // A browser refuses an expired certificate and so does `fetch`, so from the
  // crawl's side "nothing answered" and "the certificate lapsed" are the same
  // silence — and the site checks that would have named it never run, because
  // the crawl gives up first. expired.badssl.com used to come back as a guess
  // about Cloudflare Bot Fight Mode, above a sentence asserting that the TLS
  // connection had succeeded. Both halves were wrong.
  const lapsed = await audit('https://127.0.0.1:1/', {
    concurrency: 1,
    readCertificateExpiry: async () => Date.parse('2015-04-12T00:00:00Z'),
    now: Date.parse('2026-08-24T00:00:00Z'),
  });
  assert.deepEqual(lapsed.findings.map((f) => f.id), ['tls-expired']);
  assert.match(lapsed.findings[0].title, /expired 4152 days ago/);
  assert.match(lapsed.findings[0].detail, /2015-04-12/);
  // It must not also guess at bot protection: one cause, named.
  assert.doesNotMatch(lapsed.findings[0].detail, /bot-protection|Cloudflare/i);

  // The half that matters: a valid certificate still reports the guess, and no
  // longer claims to know the TLS connection succeeded when it did not.
  const healthy = await audit('https://127.0.0.1:1/', {
    concurrency: 1,
    readCertificateExpiry: async () => Date.parse('2027-01-01T00:00:00Z'),
    now: Date.parse('2026-08-24T00:00:00Z'),
  });
  assert.deepEqual(healthy.findings.map((f) => f.id), ['unreachable']);
  assert.match(healthy.findings[0].detail, /bot-protection/);

  // And a certificate that cannot be read at all falls back to the guess
  // rather than to a finding built on `null`.
  const unknown = await audit('https://127.0.0.1:1/', {
    concurrency: 1,
    readCertificateExpiry: async () => null,
  });
  assert.deepEqual(unknown.findings.map((f) => f.id), ['unreachable']);
  // The hosted Worker has no socket to read a certificate over and lands here.
  // It must not claim the certificate is fine — a runtime that cannot run a
  // check says so rather than implying a result.
  assert.doesNotMatch(unknown.findings[0].detail, /certificate is valid/);
  assert.match(healthy.findings[0].detail, /certificate is valid/);
});

// --- signing in to Search Console -----------------------------------------
//
// The flow that made `--search-console` unprovable: the three credentials were
// documented for a year with no way to obtain the third. The loopback server,
// the state check and the file write are all exercised here — only Google is
// faked, because only Google needs an account.

test('the login flow writes a refresh token without disturbing the rest of the file', async () => {
  const { login, upsertSecret } = await import('../src/console.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'seo-audit-gsc-'));
  const dotfile = join(dir, '.env');
  // A file that already holds the PageSpeed key. Clobbering it to save a
  // Search Console token would be a poor trade.
  writeFileSync(dotfile, 'PSI_API_KEY=keep-me\n');

  const fetcher = async (url) => {
    if (String(url).includes('/token')) {
      return { ok: true, json: async () => ({ refresh_token: 'r3fr3sh', access_token: 'access' }) };
    }
    return {
      ok: true,
      json: async () => ({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] }),
    };
  };

  const result = await login({
    fetcher,
    dotfile,
    client: { clientId: 'cid', clientSecret: 'secret' },
    // Stand in for the browser: read the state out of the URL it was handed and
    // call back the way Google would.
    openUrl: (url) => {
      const state = new URL(url).searchParams.get('state');
      const redirect = new URL(new URL(url).searchParams.get('redirect_uri'));
      redirect.searchParams.set('code', 'the-code');
      redirect.searchParams.set('state', state);
      fetch(redirect).catch(() => {});
      return true;
    },
  });

  assert.deepEqual(result.properties, [{ url: 'sc-domain:example.com', permission: 'siteOwner' }]);
  const written = readFileSync(dotfile, 'utf8');
  assert.match(written, /PSI_API_KEY=keep-me/);
  assert.match(written, /GSC_REFRESH_TOKEN=r3fr3sh/);

  // Rerunning replaces the line rather than appending a second one, or the
  // file grows a new token on every login and the first one wins on read.
  assert.equal(
    upsertSecret(written, 'GSC_REFRESH_TOKEN', 'newer').match(/GSC_REFRESH_TOKEN/g).length,
    1,
  );
  rmSync(dir, { recursive: true, force: true });
});

test('a reply that does not match the request is refused', async () => {
  const { login } = await import('../src/console.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'seo-audit-gsc-'));
  const dotfile = join(dir, '.env');

  await assert.rejects(
    login({
      dotfile,
      timeout: 5000,
      client: { clientId: 'cid', clientSecret: 'secret' },
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
      // A page on the internet cannot know the state, and without checking it
      // this is a port on the machine accepting codes from anywhere.
      openUrl: (url) => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri'));
        redirect.searchParams.set('code', 'planted');
        redirect.searchParams.set('state', 'not-the-state');
        fetch(redirect).catch(() => {});
        return true;
      },
    }),
    /did not match the request/,
  );
  assert.equal(existsSync(dotfile), false, 'nothing should be written on a refused reply');
  rmSync(dir, { recursive: true, force: true });
});
