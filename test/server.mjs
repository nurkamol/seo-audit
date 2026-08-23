// A fixture site on localhost, so the integration test proves the whole
// pipeline — sitemap discovery, crawling, checks, reporting — without needing
// the network or a site that might change under us.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', 'site', name), 'utf8');

export async function startFixtureSite({
  withSitemap = true,
  disallow = null,
  homeRedirect = null,
  // Paths that answer 429 the first N times they are asked for, so a test can
  // prove the crawler slows down and comes back rather than reporting the site.
  rateLimit = {},
  // Seconds to ask for in Retry-After. Shopify sends none, which is the case
  // the default backoff exists for.
  retryAfter = null,
} = {}) {
  const seen = new Map();
  const server = createServer((req, res) => {
    const host = req.headers.host;
    const limited = rateLimit[req.url];
    if (limited !== undefined) {
      const so_far = seen.get(req.url) ?? 0;
      seen.set(req.url, so_far + 1);
      if (so_far < limited) {
        res.writeHead(429, {
          'content-type': 'text/plain',
          ...(retryAfter === null ? {} : { 'retry-after': String(retryAfter) }),
        });
        return res.end('slow down');
      }
    }
    const send = (body, type = 'text/html; charset=utf-8', status = 200) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    // Fixtures are written with a HOST placeholder so absolute URLs match
    // whichever ephemeral port the test gets.
    const page = (name) => send(fixture(name).replaceAll('HOST', host));

    switch (req.url) {
      case '/robots.txt':
        return send(
          `User-agent: *\nAllow: /\n` +
            (disallow ? `Disallow: ${disallow}\n` : '') +
            (withSitemap ? `\nSitemap: http://${host}/sitemap.xml\n` : ''),
          'text/plain',
        );
      case '/sitemap.xml':
        if (!withSitemap) return send('not found', 'text/plain', 404);
        return send(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
            ['/', '/about/', '/ru/', '/hidden/']
              .map((p) => `<url><loc>http://${host}${p}</loc></url>`)
              .join('') +
            `</urlset>`,
          'application/xml',
        );
      case '/':
        // Plenty of real sites send / to a locale or a canonical path.
        if (homeRedirect) {
          res.writeHead(302, { location: homeRedirect });
          return res.end();
        }
        return page('index.html');
      case '/about/':
        return page('about.html');
      case '/ru/':
        return page('ru.html');
      case '/hidden/':
        return page('noindex.html');
      case '/og.jpg':
      case '/og.webp':
      case '/photo.jpg':
        return send('binary', 'image/jpeg');
      default:
        return send('not found', 'text/plain', 404);
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
