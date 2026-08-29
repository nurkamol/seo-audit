// The hosted front end. Everything here runs under `node --test` with nothing
// installed, because the Worker sticks to APIs Node 22 has too — which is the
// point of keeping it to fetch, Request, Response and TransformStream.
//
// The audit itself is injected, so these tests never touch the network. What
// they are about is the gate: an unconfigured deployment must not crawl, an
// unauthenticated request must not crawl, and a request for a host this
// deployment is not allowed to reach must not crawl.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handle, authorized, sameSecret, targetFor, pageLimit, progressText,
  crawlConcurrency, sitemapOverride, agentFor, idList, psiOptions, searchConsoleProperty, canReadCertificates,
} from '../worker/index.mjs';

const SECRET = 'hunter2-hunter2';
const env = (extra = {}) => ({ AUDIT_TOKEN: SECRET, ...extra });

const get = (path, { token, cookie, ...init } = {}) =>
  new Request(`https://audit.example.workers.dev${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie: `seo_audit_token=${cookie}` } : {}),
      ...(init.headers ?? {}),
    },
  });

// An audit that answers instantly and records what it was asked for, so the
// routing can be exercised without crawling a real site.
const fakeAudit = (record = {}) => async (url, opts) => {
  Object.assign(record, { url, opts });
  opts.onProgress?.({ phase: 'crawl', status: 200, ms: 12, url: `${new URL(url).origin}/p/` });
  return {
    findings: [{ level: 'warn', id: 'title-short', title: 'Title is very short', detail: 'd', url }],
    meta: { origin: new URL(url).origin, pages: 1, requests: 3, ms: 40, date: '2026-08-21', ignored: 0 },
  };
};

const read = async (response) => {
  const chunks = [];
  for await (const chunk of response.body) chunks.push(new TextDecoder().decode(chunk));
  return chunks.join('');
};

// --- the gate ---------------------------------------------------------------

test('a deployment with no secret refuses to audit anything', async () => {
  // The dangerous default. Deploying is one click; setting the secret is a
  // separate step, and between the two this must not be a crawler anyone can
  // point anywhere.
  const record = {};
  const res = await handle(get('/run?url=https://example.com'), {}, null, { audit: fakeAudit(record) });
  assert.equal(res.status, 503);
  assert.match(await read(res), /wrangler secret put AUDIT_TOKEN/);
  assert.deepEqual(record, {}, 'nothing was crawled');
});

test('an unauthenticated request gets the password form, not an audit', async () => {
  const record = {};
  for (const path of ['/', '/run?url=https://example.com', '/stream?url=https://example.com']) {
    const res = await handle(get(path), env(), null, { audit: fakeAudit(record) });
    assert.equal(res.status, 401, path);
  }
  assert.deepEqual(record, {}, 'nothing was crawled');
});

test('the wrong password is refused and the right one sets a cookie', async () => {
  const wrong = new Request('https://audit.example.workers.dev/unlock', {
    method: 'POST',
    body: new URLSearchParams({ token: 'nearly-the-secret' }),
  });
  assert.equal((await handle(wrong, env(), null)).status, 401);

  const right = new Request('https://audit.example.workers.dev/unlock', {
    method: 'POST',
    body: new URLSearchParams({ token: SECRET }),
  });
  const res = await handle(right, env(), null);
  assert.equal(res.status, 303);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
});

test('a bearer token and a cookie are both accepted', () => {
  assert.ok(authorized(get('/', { token: SECRET }), env()));
  assert.ok(authorized(get('/', { cookie: SECRET }), env()));
  assert.ok(!authorized(get('/', { token: 'wrong' }), env()));
  assert.ok(!authorized(get('/'), env()));
  assert.ok(!authorized(get('/', { token: SECRET }), {}), 'no configured secret is not a free pass');
});

test('comparing secrets does not stop at the first wrong character', () => {
  assert.ok(sameSecret('abc', 'abc'));
  assert.ok(!sameSecret('abc', 'abd'));
  assert.ok(!sameSecret('abc', 'abcd'));
  assert.ok(!sameSecret(undefined, ''), 'an unset secret matches nothing, including empty');
});

// --- what it is allowed to reach --------------------------------------------

test('only http and https, and only a real URL', () => {
  assert.equal(targetFor('https://example.com', {}).url, 'https://example.com/');
  assert.match(targetFor('example.com', {}).error, /needs the scheme/);
  assert.match(targetFor('file:///etc/passwd', {}).error, /Only http and https/);
  assert.match(targetFor('', {}).error, /not a URL/);
});

test('an allowlist keeps a deployment from being pointed anywhere', () => {
  const locked = { ALLOWED_HOSTS: 'example.com, www.example.com' };
  assert.equal(targetFor('https://example.com/page/', locked).url, 'https://example.com/page/');
  assert.equal(targetFor('https://WWW.EXAMPLE.COM/', locked).url, 'https://www.example.com/');
  assert.match(targetFor('https://someone-else.test/', locked).error, /limited to example.com/);
  // Empty means any — the default, and only sensible behind a password.
  assert.ok(targetFor('https://someone-else.test/', { ALLOWED_HOSTS: '' }).url);
});

test('the page ceiling holds whatever the form asks for', () => {
  assert.equal(pageLimit('20', { MAX_PAGES: '150' }), 20);
  assert.equal(pageLimit('5000', { MAX_PAGES: '150' }), 150, 'the form cannot raise it');
  assert.equal(pageLimit(null, {}), 150, 'and there is one without configuration');
  assert.equal(pageLimit('nonsense', {}), 150);
  assert.equal(pageLimit('-3', {}), 150);
});

test('how hard to crawl is bounded, and 1 is a real answer', () => {
  // 1 is the setting that gets through a store answering 429, so it has to
  // survive the clamp rather than being read as "unset".
  assert.equal(crawlConcurrency('1', {}), 1);
  assert.equal(crawlConcurrency('6', {}), 6);
  assert.equal(crawlConcurrency('999', {}), 12, 'a parameter that decides how many connections a stranger receives is bounded');
  assert.equal(crawlConcurrency('999', { MAX_CONCURRENCY: '3' }), 3);
  // Absent or nonsense means the engine's own default, not zero.
  assert.equal(crawlConcurrency(null, {}), 6);
  assert.equal(crawlConcurrency('nonsense', {}), 6);
  assert.equal(crawlConcurrency('0', {}), 6);
  assert.equal(crawlConcurrency('-4', {}), 6);
});

test('a sitemap override cannot point off the site being audited', () => {
  // Without this the hosted version is a fetcher for anything the machine it
  // runs on can reach, which is the whole shape of a server-side request
  // forgery.
  assert.equal(sitemapOverride('/sitemaps/all.xml', 'https://x.test/'), 'https://x.test/sitemaps/all.xml');
  assert.equal(sitemapOverride('https://x.test/s.xml', 'https://x.test/'), 'https://x.test/s.xml');
  assert.equal(sitemapOverride('https://evil.test/s.xml', 'https://x.test/'), null);
  assert.equal(sitemapOverride('http://169.254.169.254/latest/meta-data/', 'https://x.test/'), null);
  assert.equal(sitemapOverride(null, 'https://x.test/'), null);
  // Anything that is not a URL is read as a path on the site being audited,
  // which is where a sitemap would be — it still cannot leave the host.
  assert.equal(
    new URL(sitemapOverride('not a url at all', 'https://x.test/')).host,
    'x.test',
  );
});

test('a user agent is chosen from the presets, never invented', () => {
  const q = (s) => new URLSearchParams(s);
  assert.match(agentFor(q('browser=chrome&os=macos'), {}), /Macintosh/);
  assert.match(agentFor(q('browser=googlebot'), {}), /Googlebot/);

  // A name that is not a preset falls back to the deployment's own setting
  // rather than being passed through — this parameter must never become a way
  // to set an arbitrary header.
  assert.equal(agentFor(q('browser=<script>'), { USER_AGENT: 'configured' }), 'configured');
  assert.equal(agentFor(q('browser=chrome&os=Plan9'), { USER_AGENT: 'configured' }), 'configured');
  assert.equal(agentFor(q(''), { USER_AGENT: 'configured' }), 'configured');
  // A combination that cannot exist is refused by agents.mjs, and a refusal is
  // not a reason to fail the run.
  assert.equal(agentFor(q('browser=safari&os=windows'), { USER_AGENT: 'configured' }), 'configured');
});

test('a user agent of your own wins, and cannot inject a header', () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(agentFor(q('userAgent=MyBot%2F1.0&browser=chrome'), {}), 'MyBot/1.0',
    'a string of your own beats the presets');

  // This ends up in a request header. A newline in it would end the header and
  // start another one.
  const injected = agentFor(q(`userAgent=${encodeURIComponent('Evil\r\nX-Admin: 1')}`), {});
  assert.ok(!/[\r\n]/.test(injected), 'no line break survives');
  assert.equal(injected, 'EvilX-Admin: 1');

  // Bounded, because a header is not a place to put a novel.
  assert.equal(agentFor(q(`userAgent=${'a'.repeat(500)}`), {}).length, 256);

  // Whitespace is not a user agent, and falls back to the preset.
  assert.match(agentFor(q('userAgent=%20%20&browser=googlebot'), {}), /Googlebot/);
});

test('what a run can be told to do is served, reasons included', async () => {
  const res = await handle(get('/options', { token: SECRET }), env());
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(body.run.some((o) => o.flag === '--concurrency' && o.query === 'concurrency'));
  // The half that is usually missing: what is not there, and why.
  //
  // This assertion has now been re-pointed twice — off `--psi` when the window
  // reached it, then off `--search-console` when its reason stopped mentioning
  // OAuth — which is the table working and the test being too specific about
  // it. So it asserts the property that matters instead: every absence carries
  // a reason somebody can read. `--search-console-login` is the spot check,
  // because opening a browser to write a credential is a terminal errand and
  // will not become a control in a window.
  assert.ok(body.notInApp.length, 'a flag the window does not reach is still listed');
  for (const entry of body.notInApp) {
    assert.ok(entry.flag.startsWith('--'), 'each absence names its flag');
    assert.ok(
      typeof entry.reason === 'string' && entry.reason.split(' ').length >= 5,
      `${entry.flag} is listed as absent without a reason worth reading`,
    );
  }
  const login = body.notInApp.find((o) => o.flag === '--search-console-login');
  assert.ok(login, 'the sign-in errand is listed as something the window does not do');
  assert.match(login.reason, /browser|credential/, 'with the reason, not just its absence');
});

test('silenced checks are a list of ids, not an open field', () => {
  assert.deepEqual(idList('thin-content, img-srcset'), ['thin-content', 'img-srcset']);
  assert.deepEqual(idList(null), []);
  assert.deepEqual(idList(''), []);
  // Every id is matched against every finding, so this is bounded and shaped.
  assert.deepEqual(idList('Bad Id,../../etc,<script>'), []);
  assert.equal(idList(Array.from({ length: 500 }, () => 'thin-content').join(',')).length, 100);
});

test('PageSpeed is off unless the deployment says otherwise', () => {
  const q = (s) => new URLSearchParams(s);

  // A hosted deployment: a stranger passing ?psi= would be spending somebody
  // else's quota and somebody else's seconds.
  assert.deepEqual(psiOptions(q('psi=/'), {}), {});
  assert.deepEqual(psiOptions(q('psi=/'), { ALLOW_PSI: '0' }), {});

  const on = psiOptions(q('psi=/,/docs/**&psi-strategy=desktop'), { ALLOW_PSI: '1' });
  assert.deepEqual(on.psi, ['/', '/docs/**']);
  assert.equal(on.psiStrategy, 'desktop');

  // Each target is seconds of waiting, so the sample is clamped and anything
  // that is not "desktop" is mobile rather than passed through.
  assert.equal(psiOptions(q('psi=/&psi-sample=99'), { ALLOW_PSI: '1' }).psiSample, 10);
  assert.equal(psiOptions(q('psi=/&psi-strategy=nonsense'), { ALLOW_PSI: '1' }).psiStrategy, 'mobile');
  // Asking for nothing is not asking.
  assert.deepEqual(psiOptions(q(''), { ALLOW_PSI: '1' }), {});
});

test('what the window silences reaches the audit', async () => {
  const record = {};
  await read(await handle(
    get('/stream?url=https://example.com&ignore=thin-content,img-srcset', { token: SECRET }),
    env(),
    null,
    { audit: fakeAudit(record), report: () => '' },
  ));
  assert.deepEqual(record.opts.ignore, ['thin-content', 'img-srcset']);
});

test('a preview says what a run would do without doing it', async () => {
  // A full crawl is minutes and a few hundred requests to somebody else's
  // server. This is the way to find out it is pointed at the wrong site first.
  const res = await handle(get('/preview?url=https://example.com&limit=25', { token: SECRET }), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');

  const refused = await handle(get('/preview?url=https://elsewhere.test/', { token: SECRET }),
    env({ ALLOWED_HOSTS: 'example.com' }));
  assert.equal(refused.status, 400, 'a preview is bounded by the same allow-list as a crawl');

  assert.equal((await handle(get('/preview?url=https://example.com'), env())).status, 401);
});

test('two runs are compared by the engine, not by whatever asked', async () => {
  // diff() is what --baseline has always used. The macOS app posts here rather
  // than comparing in Swift, so "did this get better" has one answer.
  const was = {
    meta: { pages: 10, date: '2026-08-17' },
    findings: [
      { level: 'warn', id: 'title-long', title: 'T', detail: 'd', url: 'https://x.test/a' },
      { level: 'warn', id: 'thin-content', title: 'T', detail: 'd', url: 'https://x.test/b' },
    ],
  };
  const now = {
    meta: { pages: 10, date: '2026-08-24' },
    findings: [
      { level: 'warn', id: 'title-long', title: 'T', detail: 'd', url: 'https://x.test/a' },
      { level: 'error', id: 'h1-missing', title: 'T', detail: 'd', url: 'https://x.test/c' },
    ],
  };

  const res = await handle(
    get('/diff', { token: SECRET, method: 'POST', body: JSON.stringify({ previous: was, current: now }) }),
    env(),
  );
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.deepEqual(body.added.findings.map((f) => f.id), ['h1-missing'], 'appeared since last time');
  assert.deepEqual(body.fixed.findings.map((f) => f.id), ['thin-content'], 'gone since last time');
  assert.equal(body.unchanged, 1, 'still there, and not worth reading twice');
  assert.equal(body.previousDate, '2026-08-17');

  // Grouped by the same function everything else groups by, so a regression on
  // forty pages reads as one thing rather than forty rows.
  assert.equal(body.added.causes.length, 1);
  assert.equal(body.added.causes[0].id, 'h1-missing');
  assert.ok(body.added.causes[0].scope, 'the scope sentence comes with it');
});

test('a comparison refuses a body it cannot compare', async () => {
  const bad = async (payload) =>
    (await handle(get('/diff', { token: SECRET, method: 'POST', body: payload }), env())).status;

  assert.equal(await bad('not json'), 400);
  assert.equal(await bad(JSON.stringify({ previous: {}, current: {} })), 400);
  assert.equal(await bad(JSON.stringify({ current: { findings: [] } })), 400);
  // The gate covers this like everything else.
  assert.equal(
    (await handle(get('/diff', { method: 'POST', body: '{}' }), env())).status,
    401,
  );
});

test('the presets are served rather than copied into every client', async () => {
  // Behind the same gate as everything else. The Mac app never sees the gate:
  // src/serve.mjs mints a token and adds the header on the way through.
  assert.equal((await handle(get('/agents'), env())).status, 401, 'the gate holds here too');

  const res = await handle(get('/agents', { token: SECRET }), env());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.browsers.includes('googlebot'));
  assert.ok(body.systems.includes('macos'));
});

// --- the run ----------------------------------------------------------------

test('what the settings say reaches the audit, and defaults are left alone', async () => {
  // The Mac app's Settings assembles these. If they stopped arriving, a gentle
  // crawl would silently be a normal one — and the whole reason that setting
  // exists is a store that only answers at one connection.
  const record = {};
  await read(await handle(
    get('/stream?url=https://example.com&limit=25&concurrency=1&external=1'
        + '&browser=googlebot&sitemap=%2Fsitemaps%2Fall.xml', { token: SECRET }),
    env(),
    null,
    { audit: fakeAudit(record), report: () => '' },
  ));
  assert.equal(record.opts.concurrency, 1);
  assert.equal(record.opts.checkExternal, true);
  assert.equal(record.opts.sitemap, 'https://example.com/sitemaps/all.xml');
  assert.match(record.opts.userAgent, /Googlebot/);

  // Asking for nothing must not pin the engine's defaults from out here: a
  // default written down in two places is a default that changes in one.
  const plain = {};
  await read(await handle(
    get('/stream?url=https://example.com', { token: SECRET }),
    env(),
    null,
    { audit: fakeAudit(plain), report: () => '' },
  ));
  assert.equal(plain.opts.checkExternal, false);
  assert.equal(plain.opts.sitemap, null);
});

test('a stream carries the progress and then the report', async () => {
  const record = {};
  const res = await handle(
    get('/stream?url=https://example.com&limit=25', { token: SECRET }),
    env(),
    null,
    { audit: fakeAudit(record), report: (findings) => `<!doctype html>${findings.length} findings` },
  );
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');

  const body = await read(res);
  assert.match(body, /event: progress/);
  assert.match(body, /crawl {2}.*200/);
  assert.match(body, /event: done/);
  assert.match(body, /2 findings/, 'the report was rendered and sent');

  assert.equal(record.url, 'https://example.com/');
  assert.equal(record.opts.limit, 25);
});

test('the report says the certificate was not checked, rather than dropping it', async () => {
  // A hosted report with two checks fewer than the CLI's, and no note saying
  // so, is a report that lies by omission: a missing finding reads exactly
  // like a passing one.
  let sent;
  await handle(
    get('/stream?url=https://example.com', { token: SECRET }),
    env(),
    null,
    { audit: fakeAudit(), report: (findings) => { sent = findings; return 'ok'; } },
  ).then(read);

  const note = sent.find((f) => f.id === 'tls-not-checked');
  assert.ok(note, 'expected the hosted report to declare what it could not check');
  assert.equal(note.level, 'info');
  assert.match(note.detail, /npx github:nurkamol\/seo-audit/);
});

test('a run that throws is reported to the browser, not left hanging', async () => {
  const res = await handle(
    get('/stream?url=https://example.com', { token: SECRET }),
    env(),
    null,
    { audit: async () => { throw new Error('the site is not answering'); } },
  );
  const body = await read(res);
  assert.match(body, /event: failed/);
  assert.match(body, /the site is not answering/);
});

test('a refused host never reaches the audit, on either route', async () => {
  const record = {};
  const locked = env({ ALLOWED_HOSTS: 'example.com' });
  for (const path of ['/run?url=https://elsewhere.test', '/stream?url=https://elsewhere.test']) {
    const res = await handle(get(path, { token: SECRET }), locked, null, { audit: fakeAudit(record) });
    assert.equal(res.status, 400, path);
  }
  assert.deepEqual(record, {}, 'nothing was crawled');
});

// --- the rest ---------------------------------------------------------------

test('the deployment asks not to be indexed', async () => {
  const res = await handle(get('/robots.txt'), env(), null);
  assert.equal(await res.text(), 'User-agent: *\nDisallow: /\n');
  // And the pages themselves, since a report about someone else's site turning
  // up in a search result is a different kind of problem.
  const form = await handle(get('/', { token: SECRET }), env(), null);
  assert.match(await form.text(), /<meta name="robots" content="noindex, nofollow">/);
});

test('progress reads as a line of text, with the origin taken off the front', () => {
  assert.equal(
    progressText({ phase: 'crawl', status: 200, ms: 12, url: 'https://x.test/a/' }, 'https://x.test'),
    'crawl      200     12ms  /a/',
  );
  assert.equal(
    progressText({ phase: 'links', status: 404, ms: 5, url: 'https://other.test/gone' }, 'https://x.test'),
    'links      404      5ms  https://other.test/gone',
  );
  assert.equal(progressText({ phase: 'checks', detail: '12 findings' }, 'https://x.test'), 'checks     12 findings');
});

// Search Console is off unless the runtime says otherwise, and the reason is
// sharper than the one for PageSpeed.
//
// The credentials belong to whoever started the server, not to whoever sent the
// request. A deployed Worker honouring `?search-console=` would let a stranger
// name any property that account can read and get its impressions back — other
// people's traffic data, out of other people's Search Console. `--serve` turns
// it on only because it binds to the loopback address and serves the person who
// started it.
test('a request cannot name a Search Console property unless the runtime allows it', () => {
  const q = (v) => new URLSearchParams(v === null ? {} : { 'search-console': v });
  const on = { ALLOW_SEARCH_CONSOLE: '1' };

  // The gate, which is the whole point.
  assert.deepEqual(searchConsoleProperty(q('sc-domain:example.com'), {}), {});
  assert.deepEqual(searchConsoleProperty(q('sc-domain:example.com'), { ALLOW_PSI: '1' }), {});

  assert.deepEqual(searchConsoleProperty(q('sc-domain:example.com'), on), {
    searchConsole: 'sc-domain:example.com',
  });
  assert.deepEqual(searchConsoleProperty(q('https://example.com/'), on), {
    searchConsole: 'https://example.com/',
  });

  // A property is one of two shapes. Anything else is not worth a round trip,
  // and some of it is somebody trying their luck.
  for (const junk of ['../../etc/passwd', 'file:///etc/passwd', 'sc-domain:', '<script>', 'a b', '']) {
    assert.deepEqual(searchConsoleProperty(q(junk), on), {}, `${junk} should be refused`);
  }
  assert.deepEqual(searchConsoleProperty(q('sc-domain:' + 'a'.repeat(300)), on), {});
  assert.deepEqual(searchConsoleProperty(q(null), on), {});
});

// The certificate note belongs to the runtime that cannot run the check, and
// to nothing else.
//
// This module runs in two places: Cloudflare, which has no socket to read a
// certificate over, and `--serve` under Node, which does. It used to switch the
// check off for both — so the macOS window, which talks to `--serve`, skipped a
// check it could perfectly well run and then reported that "this report was
// produced by the hosted version". A missing finding reads exactly like a
// passing one, and a note claiming the wrong runtime is worse than either.
test('only a runtime that cannot read a certificate says so', () => {
  assert.equal(canReadCertificates({}), false, 'a deployed Worker cannot');
  assert.equal(canReadCertificates({ ALLOW_PSI: '1' }), false, 'and no other flag grants it');
  assert.equal(canReadCertificates({ CAN_READ_CERTIFICATES: '1' }), true, '--serve can');
  // Set, but not to the one value that means yes.
  assert.equal(canReadCertificates({ CAN_READ_CERTIFICATES: 'true' }), false);
  assert.equal(canReadCertificates({ CAN_READ_CERTIFICATES: '0' }), false);
});

// --- the browser's half of the app ----------------------------------------

test('the form is built from the table that knows every flag', async () => {
  const res = await handle(get('/', { token: SECRET }), env());
  const html = await read(res);

  // It offered two inputs while the engine took a dozen parameters, so
  // somebody at a browser reached a sixth of what somebody at a terminal did.
  for (const name of ['limit', 'concurrency', 'external', 'sitemap', 'browser', 'os', 'userAgent', 'ignore']) {
    assert.match(html, new RegExp(`name="${name}"`), `the form should offer ${name}`);
  }
  // The browser menu is the engine's own list, asked for rather than copied.
  // The value stays the token the command line takes; only the label reads
  // like a name, so the form is not a second vocabulary to keep in step.
  assert.match(html, /<option value="googlebot">Googlebot<\/option>/);
  assert.match(html, /<option value="macos">macOS<\/option>/);

  // PageSpeed spends somebody's quota and Search Console reads somebody's
  // account, so neither is drawn unless the deployment says they are the
  // visitor's own to spend.
  assert.doesNotMatch(html, /name="psi"/);
  assert.doesNotMatch(html, /name="search-console"/);

  const local = await read(await handle(get('/', { token: SECRET }),
    env({ ALLOW_PSI: '1', ALLOW_SEARCH_CONSOLE: '1' })));
  assert.match(local, /name="psi"/);
  assert.match(local, /name="search-console"/);
});

test('every setting the form collects reaches the run', async () => {
  const res = await handle(
    get('/run?url=https://x.test&limit=9&concurrency=1&external=1&browser=Chrome&ignore=og-webp',
      { token: SECRET }),
    env({ ALLOWED_HOSTS: 'x.test' }),
  );
  const html = await read(res);
  // A control somebody set and the engine never saw is worse than no control:
  // it is a setting that quietly does nothing.
  for (const pair of ['limit=9', 'concurrency=1', 'external=1', 'browser=Chrome', 'ignore=og-webp']) {
    assert.ok(html.includes(pair), `the stream URL should carry ${pair}`);
  }
});

test('a deployed Worker has no library, and a local server does', async () => {
  // Cloudflare has no filesystem, and a shared host keeping strangers' crawls
  // is a thing nobody asked for. No store, no pages.
  assert.equal((await handle(get('/reports', { token: SECRET }), env())).status, 404);

  const rows = [];
  const store = {
    list: () => rows,
    read: (id) => rows.find((r) => r.id === id)?.payload ?? null,
    keep: () => null,
    where: () => '/tmp/reports',
    bytes: () => 1024,
  };

  const empty = await read(await handle(get('/reports', { token: SECRET }), env({ STORE: store })));
  assert.match(empty, /Nothing kept yet/);

  rows.push({
    id: '11111111-1111-4111-8111-111111111111',
    host: 'x.test', finishedAt: '2026-01-01T10:00:00Z', pages: 3, causes: 2, score: 74,
    payload: { meta: { origin: 'https://x.test', pages: 3, date: '2026-01-01' }, findings: [], causes: [] },
  });
  const listed = await read(await handle(get('/reports', { token: SECRET }), env({ STORE: store })));
  assert.match(listed, /x\.test/);
  assert.match(listed, /74\/100/);

  // And one of them opens as the same report every other front end draws.
  const one = await read(await handle(
    get('/reports/11111111-1111-4111-8111-111111111111', { token: SECRET }), env({ STORE: store })));
  assert.match(one, /^<!doctype html>/i);
  assert.match(one, /x\.test/);
});

test('a comparison needs two, and says when it matched by path', async () => {
  const run = (origin, date, findings) => ({
    meta: { origin, pages: 2, date },
    findings,
    causes: [],
  });
  const rows = [
    { id: '11111111-1111-4111-8111-111111111111', payload:
      run('https://old.test', '2026-01-01', [
        { level: 'warn', id: 'desc-missing', title: 'No description', detail: 'x', url: 'https://old.test/a' },
      ]) },
    { id: '22222222-2222-4222-8222-222222222222', payload:
      run('https://new.test', '2026-02-01', [
        { level: 'error', id: 'h1-missing', title: 'No h1', detail: 'x', url: 'https://new.test/a' },
      ]) },
  ];
  const store = {
    list: () => rows,
    read: (id) => rows.find((r) => r.id === id)?.payload ?? null,
    keep: () => null,
    where: () => '/tmp',
    bytes: () => 0,
  };

  const one = await handle(get('/compare?run=11111111-1111-4111-8111-111111111111', { token: SECRET }),
    env({ STORE: store }));
  assert.equal(one.status, 400);
  assert.match(await read(one), /Pick two/);

  const both = await read(await handle(
    get('/compare?run=11111111-1111-4111-8111-111111111111&run=22222222-2222-4222-8222-222222222222',
      { token: SECRET }),
    env({ STORE: store }),
  ));
  // Different origins, so the engine matched by path — and the page says so
  // rather than leaving somebody to wonder why nothing lines up.
  assert.match(both, /matched by path/);
  assert.match(both, /Appeared/);
  assert.match(both, /Gone/);
});

test('a preview is a page as well as a payload', async () => {
  // /preview answers a client; /plan answers a person, and it is the button
  // beside Audit. A preview nobody can reach is a preview nobody uses.
  const res = await handle(get('/plan?url=not-a-url', { token: SECRET }), env());
  assert.equal(res.status, 400);
  assert.match(await read(res), /Not previewed/);
});

// --- the window, in a browser ---------------------------------------------

test('a served report is the report, not a second rendering of it', async () => {
  const { reportParts } = await import('../src/report.mjs');
  const meta = { origin: 'https://x.test', pages: 3, date: '2026-01-01' };
  const findings = [
    { level: 'warn', id: 'desc-missing', title: 'No description', detail: 'x', url: 'https://x.test/a' },
  ];
  const rows = [{
    id: '11111111-1111-4111-8111-111111111111',
    host: 'x.test', finishedAt: '2026-01-01T10:00:00Z', pages: 3, causes: 1, score: 74,
    payload: { meta, findings, causes: [] },
  }];
  const store = {
    list: () => rows,
    read: (id) => rows.find((r) => r.id === id)?.payload ?? null,
    keep: () => null, where: () => '/tmp', bytes: () => 0,
  };

  const html = await read(await handle(
    get('/reports/11111111-1111-4111-8111-111111111111', { token: SECRET }), env({ STORE: store })));

  // The report's own body, character for character — the served page composes
  // the same parts `--html` writes rather than drawing its own version. Two
  // renderings of one report is exactly the drift this project refuses.
  const parts = reportParts(findings, meta, {});
  assert.ok(html.includes(parts.body), 'the served page should carry the report body verbatim');
  assert.ok(html.includes('--error:'), 'and the report stylesheet, not a second one');

  // The window's chrome around it: the sidebar the macOS app has, with the run
  // that is on screen marked as the one on screen.
  assert.match(html, /class="side"/);
  assert.match(html, /New audit/);
  assert.match(html, /aria-current="page"/);
  // 74 is fair, not good — the same thresholds gradeOf() uses.
  assert.match(html, /class="chip fair">74/);
});

test('a deployed Worker serves a document, not a window', async () => {
  // No store means no library, so there is no sidebar to draw and the report
  // has to stand alone — which is what a hosted report has always been.
  const html = await read(await handle(get('/', { token: SECRET }), env()));
  assert.doesNotMatch(html, /class="run"/);
  // The form is still the form.
  assert.match(html, /name="url"/);
});

test('the score chip changes colour where the dial does', async () => {
  const rows = (score) => [{
    id: '11111111-1111-4111-8111-111111111111', host: 'x.test',
    finishedAt: '2026-01-01T10:00:00Z', pages: 1, causes: 0, score,
  }];
  const at = async (score) => read(await handle(get('/', { token: SECRET }), env({
    STORE: { list: () => rows(score), read: () => null, keep: () => null, where: () => '/tmp', bytes: () => 0 },
  })));

  // gradeOf()'s thresholds, so a dial in the window and a chip here never
  // disagree about what 80 looks like.
  assert.match(await at(80), /chip good/);
  assert.match(await at(79), /chip fair/);
  assert.match(await at(60), /chip fair/);
  assert.match(await at(59), /chip poor/);
});

// --- saving a report from the window --------------------------------------
// The macOS app has had an Export menu since it shipped and the browser had
// none, so somebody on Linux could read a report and not save one. Downloads
// rather than a native dialog: it works in a plain browser as well as in the
// desktop shell, and the shell gaining a control the served UI lacks is the one
// thing it must not do.

const keptStore = (payload) => {
  const rows = [{ id: '11111111-1111-4111-8111-111111111111', host: 'x.test',
    finishedAt: '2026-01-01T10:00:00Z', pages: 2, causes: 0, score: 90 }];
  return {
    list: () => rows,
    read: (id) => (id === rows[0].id ? payload : null),
    keep: () => null, where: () => '/tmp', bytes: () => 0,
  };
};

test('every format the engine can write can be saved from the window', async () => {
  const { FORMATS } = await import('../src/exports.mjs');
  const payload = {
    meta: { origin: 'https://x.test', pages: 2, date: '2026-01-01' },
    findings: [{ level: 'warn', id: 'desc-missing', title: 'No description', detail: 'x', url: 'https://x.test/a' }],
    causes: [],
    sitemap: { xml: '<urlset/>', urls: [], added: [], refused: null },
    llms: { text: '# x.test\n', urls: [], sections: 1, refused: null },
    schema: { json: '{"generated":[]}\n', generated: [], skipped: {}, refused: null },
  };
  const store = keptStore(payload);

  for (const format of FORMATS) {
    const res = await handle(
      get(`/reports/11111111-1111-4111-8111-111111111111/export?as=${format.id}`, { token: SECRET }),
      env({ STORE: store }),
    );
    assert.equal(res.status, 200, `${format.id} should save`);
    // A name somebody can find again, and that sorts.
    assert.match(
      res.headers.get('content-disposition') ?? '',
      new RegExp(`attachment; filename="seo-audit-x\\.test-\\d{4}-\\d{2}-\\d{2}\\.${format.extension}"`),
      `${format.id} should be named for the site and the day`,
    );
    assert.ok((await read(res)).length > 5, `${format.id} wrote almost nothing`);
  }
});

// The refusal is the useful half. An empty file would look like a working
// export; a page saying which run would have built one does not.
test('a format this run did not build says so instead of downloading nothing', async () => {
  const store = keptStore({ meta: { origin: 'https://x.test', pages: 2, date: '2026-01-01' }, findings: [], causes: [] });
  const res = await handle(
    get('/reports/11111111-1111-4111-8111-111111111111/export?as=llms', { token: SECRET }),
    env({ STORE: store }),
  );
  assert.equal(res.status, 409);
  const page = await read(res);
  assert.match(page, /No llms.txt to save/);
  assert.match(page, /did not build an llms.txt/);

  // And a format or a report that does not exist is a 404, not a blank file.
  assert.equal((await handle(
    get('/reports/11111111-1111-4111-8111-111111111111/export?as=nonsense', { token: SECRET }),
    env({ STORE: store }))).status, 404);
  assert.equal((await handle(
    get('/reports/22222222-2222-4222-8222-222222222222/export?as=html', { token: SECRET }),
    env({ STORE: store }))).status, 404);
});

// Found by clicking the links rather than by writing this test: a run started
// from the browser never asked the engine to build the sitemap, the llms.txt or
// the structured data, so three of the seven Save-as links were permanently
// refused for every Linux and Windows user. The macOS window has always asked.
test('a run started from the browser builds everything it will offer to save', async () => {
  const html = await read(await handle(
    get('/run?url=https://x.test&limit=5', { token: SECRET }),
    env({ ALLOWED_HOSTS: 'x.test' }),
  ));
  for (const wanted of ['sitemap-out=1', 'llms-out=1', 'schema-out=1']) {
    assert.ok(html.includes(wanted), `the run should ask for ${wanted}`);
  }
});

test('a report in the window offers the whole list, refusals included', async () => {
  const { FORMATS } = await import('../src/exports.mjs');
  const store = keptStore({ meta: { origin: 'https://x.test', pages: 2, date: '2026-01-01' }, findings: [], causes: [] });
  const page = await read(await handle(
    get('/reports/11111111-1111-4111-8111-111111111111', { token: SECRET }), env({ STORE: store })));

  // Offered even where the run built nothing: following the link lands on the
  // reason, which is more use than a control missing without saying why.
  for (const format of FORMATS) {
    assert.match(page, new RegExp(`export\\?as=${format.id}"`), `${format.id} should be offered`);
  }
});
