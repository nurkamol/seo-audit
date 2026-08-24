// The hosted front end, running locally.
//
// Not a second implementation of it: `worker/index.mjs` is written against
// `Request` and `Response`, which Node has, so the same file answers both. What
// is here is thirty lines of adapter between `node:http` and the fetch API, and
// the reason the Worker was held to web standards in the first place.
//
// What this has that the Worker cannot: no CPU ceiling, no subrequest limit, no
// bill. A five-thousand-page site with `maxImageChecks` past a thousand fits
// here and nowhere else.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import { handle } from '../worker/index.mjs';

/** Start the local UI. Returns `{ url, close }`.
 *
 *  Bound to the loopback address, which is the whole of its security model: a
 *  server only this machine can reach is as private as the terminal that
 *  started it.
 *
 *  The Worker's password gate is left exactly as it is rather than given a
 *  local exemption — a bypass inside the deployed code is a bypass that can
 *  reach production one refactor later. Instead a random token is minted here
 *  and the adapter presents it on every request, so the gate is satisfied
 *  rather than skipped. */
export async function serve({ port = 4321, host = '127.0.0.1', maxPages, allowedHosts, userAgent } = {}) {
  const token = randomUUID();
  const env = {
    AUDIT_TOKEN: token,
    ...(maxPages ? { MAX_PAGES: String(maxPages) } : {}),
    ...(allowedHosts ? { ALLOWED_HOSTS: allowedHosts } : {}),
    ...(userAgent ? { USER_AGENT: userAgent } : {}),
    // PageSpeed is allowed here and nowhere else by default: --serve is bound to
    // the loopback address and the person running it is the person it serves, so
    // spending their own PSI quota is their decision. A deployed Worker leaves
    // this unset, where a stranger passing ?psi= would be spending somebody
    // else's.
    ALLOW_PSI: '1',
    // Same reasoning, sharper stakes: these credentials read somebody's Search
    // Console. On the loopback address the person running the server is the
    // person whose account it is; a deployed Worker leaves this unset, where
    // `?search-console=` would hand a stranger somebody else's traffic data.
    ALLOW_SEARCH_CONSOLE: '1',
  };

  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = `http://${incoming.headers.host ?? `${host}:${port}`}${incoming.url}`;
      const body =
        incoming.method === 'GET' || incoming.method === 'HEAD'
          ? undefined
          : await new Promise((resolve) => {
              const chunks = [];
              incoming.on('data', (chunk) => chunks.push(chunk));
              incoming.on('end', () => resolve(Buffer.concat(chunks)));
            });

      const request = new Request(url, {
        method: incoming.method,
        headers: { ...incoming.headers, authorization: `Bearer ${token}` },
        body,
      });

      const response = await handle(request, env, null);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
      else outgoing.end();
    } catch (err) {
      outgoing.writeHead(500, { 'content-type': 'text/plain' });
      outgoing.end(`The local server failed: ${err.message}\n`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const { port: bound } = server.address();
  return {
    url: `http://${host}:${bound}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
