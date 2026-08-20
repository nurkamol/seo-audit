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

import { handle, authorized, sameSecret, targetFor, pageLimit, progressText } from '../worker/index.mjs';

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

// --- the run ----------------------------------------------------------------

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
