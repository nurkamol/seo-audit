// Whole-site checks: the files and headers that exist once per domain, plus
// the link graph, which is the thing single-page graders can never see.
import { connect } from 'node:tls';
import { mapLimit } from './http.mjs';
import { parseRobots, robotsVerdict } from './robots.mjs';

// Two weeks is enough to renew by hand if the automation has quietly stopped,
// which is the failure this is for — nobody is short of warning about a
// certificate they knew was expiring.
const CERT_WARN_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/** When the certificate expires, or null if that cannot be established.
 *
 *  Deliberately its own connection rather than anything read off a fetch: Node
 *  does not expose the peer certificate through `fetch`, and this is the whole
 *  of the dependency-free way to ask. */
export function certificateExpiry(hostname, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    let socket;
    const done = (value) => {
      socket?.destroy();
      resolve(value);
    };
    try {
      // Validation is switched off deliberately, and only here. An *expired*
      // certificate fails the handshake, so a validating connection cannot read
      // the one fact this function exists to report — the check would go silent
      // in exactly the case it is for. Nothing is sent over this socket and
      // nothing is read from it but the certificate's dates, which are the same
      // ones a browser would show.
      // SNI is not permitted to carry an IP address (RFC 6066), and Node warns
      // about it. An IP has no name to send.
      const isIp = /^[\d.]+$/.test(hostname) || hostname.includes(':');
      socket = connect(
        {
          host: hostname,
          port: 443,
          ...(isIp ? {} : { servername: hostname }),
          timeout,
          rejectUnauthorized: false,
        },
        () => {
          const cert = socket.getPeerCertificate();
          done(cert?.valid_to ? Date.parse(cert.valid_to) : null);
        },
      );
    } catch {
      return resolve(null);
    }
    // A host that is not listening, or not speaking TLS, has nothing to say.
    socket.on('error', () => done(null));
    socket.on('timeout', () => done(null));
  });
}

const f = (level, id, title, detail, url) => ({ level, id, title, detail, url });

export async function siteChecks(origin, fetcher, pages, opts = {}) {
  // Every URL the sitemap listed, not only the ones this run crawled — with
  // --limit in play they are not the same set, and treating them as the same
  // reports every uncrawled page as missing from the sitemap.
  const inSitemap = new Set((opts.sitemapUrls ?? []).map((u) => u.replace(/\/$/, '')));
  const out = [];
  const base = new URL(origin);

  // --- robots.txt ---------------------------------------------------------
  const robots = await fetcher.get(new URL('/robots.txt', base).toString());
  let blocksAll = false;
  if (!robots.ok) {
    out.push(f('warn', 'robots-missing', 'No robots.txt',
      `HTTP ${robots.status}. Not fatal, but it is where the sitemap is advertised.`, robots.url));
  } else {
    if (/^\s*disallow:\s*\/\s*$/im.test(robots.body) && /user-agent:\s*\*/i.test(robots.body)) {
      blocksAll = true;
      out.push(f('error', 'robots-blocks-all', 'robots.txt blocks the whole site',
        'Disallow: / for User-agent: *. Nothing will be indexed.', robots.url));
    }
    if (!/sitemap:/i.test(robots.body)) {
      out.push(f('info', 'robots-no-sitemap', 'robots.txt does not list a sitemap',
        'One line, and every crawler finds the sitemap without guessing.', robots.url));
    }

    // The site contradicting itself: the sitemap says index this, robots.txt
    // says do not crawl it. Skipped when the whole site is blocked, because
    // that is already reported above and this would restate it once per URL.
    if (!blocksAll) {
      const groups = parseRobots(robots.body);
      const blocked = [];
      for (const listed of opts.sitemapUrls ?? []) {
        let path;
        try {
          path = new URL(listed).pathname;
        } catch {
          continue;
        }
        const verdict = robotsVerdict(groups, path);
        if (!verdict.allowed) blocked.push({ listed, rule: verdict.rule });
      }
      if (blocked.length) {
        const shown = blocked.slice(0, 3).map((b) => `${b.listed} (Disallow: ${b.rule.path})`).join(', ');
        out.push(f('error', 'robots-blocks-sitemap-url',
          `${blocked.length} sitemap URL(s) are disallowed by robots.txt`,
          `${shown}${blocked.length > 3 ? `, and ${blocked.length - 3} more` : ''}. The sitemap asks Google ` +
            'to index these and robots.txt forbids fetching them, so they land in the index without a ' +
            'description, or not at all. One of the two files is wrong.', robots.url));
      }
    }
  }

  // --- llms.txt -----------------------------------------------------------
  const llms = await fetcher.get(new URL('/llms.txt', base).toString());
  if (!llms.ok) {
    out.push(f('info', 'llms-missing', 'No llms.txt',
      'The emerging convention for telling AI assistants what a site is and which pages matter.', llms.url));
  }

  // --- Soft 404s ----------------------------------------------------------
  // A URL that cannot exist has to answer 404. When it answers 200 instead,
  // every typo, every stale inbound link and every crawler guess becomes an
  // indexable page, and the site quietly fills the index with copies of its own
  // error page. Nothing on the site reveals this — you have to ask for
  // something missing, which no visitor and no single-page grader ever does.
  //
  // A fixed path rather than a random one, so the finding is identical between
  // runs and --baseline has something stable to compare.
  // The chain is followed and only the *final* answer judged, because the first
  // hop says almost nothing. Two real behaviours seen in the wild: wikipedia.org
  // answers 301 and then 404, which is correct and must stay silent; vercel.com
  // answers 308 to strip the trailing slash and then 200, which is a soft 404
  // that reading only the first hop would miss entirely.
  const probe = new URL('/seo-audit-probe-404/', base).toString();
  const { hops, final } = await fetcher.chain(probe);
  const servedHtml = /text\/html/i.test(final.headers.get('content-type') ?? '');

  if (final.status === 200 && servedHtml) {
    // hops already includes the final response, so it is not appended again.
    const route =
      hops.length > 1
        ? `answers ${hops.map((h) => h.status).join(' → ')}, ending at ${final.url}`
        : 'answers 200 directly';
    const landedHome = final.url.replace(/\/$/, '') === base.origin.replace(/\/$/, '');
    // A 200 that says noindex is a deliberate mitigation rather than an
    // oversight: still wrong, because Google wants the status code, but the page
    // will not be indexed and the damage stops there.
    const metaRobots = final.body.match(/<meta[^>]+name=["']robots["'][^>]*>/i)?.[0] ?? '';
    const noindexed =
      /noindex/i.test(metaRobots) || /noindex/i.test(final.headers.get('x-robots-tag') ?? '');

    if (landedHome) {
      out.push(f('warn', 'soft-404', 'Missing pages end up on the homepage instead of 404ing',
        `${probe} ${route}. Google treats this as a soft 404 regardless, and a visitor who followed a ` +
          'broken link lands on the homepage with no idea what went wrong.', probe));
    } else if (noindexed) {
      out.push(f('warn', 'soft-404', 'A page that does not exist answers 200, but is noindexed',
        `${probe} ${route}. The noindex keeps it out of the index, but crawlers still spend budget on ` +
          'every missing URL, and nothing tells a visitor the link is dead.', probe));
    } else {
      out.push(f('error', 'soft-404', 'A page that does not exist answers 200',
        `${probe} ${route}, with an HTML body. Every mistyped or stale URL is a live, indexable page, ` +
          'so the index fills with copies of the error page. Return a real 404.', probe));
    }
  }

  // --- Canonical host and scheme -----------------------------------------
  // One hop is right. Two means every visitor pays for a wasted round trip.
  const host = base.host.replace(/^www\./, '');
  const variants = [`http://${host}/`, `https://www.${host}/`, `http://www.${host}/`];
  for (const variant of variants) {
    const { hops, final } = await fetcher.chain(variant);
    if (!final.ok) {
      out.push(f('warn', 'host-variant-dead', `${variant} does not resolve to a page`,
        final.error ? `Request failed: ${final.error}` : `Ends at HTTP ${final.status}`, variant));
    } else if (hops.length > 2) {
      out.push(f('warn', 'redirect-chain', `${variant} takes ${hops.length - 1} redirects`,
        hops.map((h) => `${h.status} ${h.url}`).join(' → '), variant));
    }
  }

  // --- Certificate --------------------------------------------------------
  // Not an SEO check, and the only thing here that takes a site off the
  // internet completely. A browser refuses to load an expired certificate, so
  // the ranking becomes irrelevant along with everything else.
  if (base.protocol === 'https:') {
    // Injectable so the thresholds can be tested without a live certificate
    // that would have to be reissued to keep the test meaningful.
    const readExpiry = opts.readCertificateExpiry ?? certificateExpiry;
    const expiresAt = await readExpiry(base.hostname);
    if (expiresAt) {
      const days = Math.floor((expiresAt - (opts.now ?? Date.now())) / DAY);
      const on = new Date(expiresAt).toISOString().slice(0, 10);
      if (days < 0) {
        out.push(f('error', 'tls-expired', `The TLS certificate expired ${-days} day(s) ago`,
          `It ran out on ${on}. Browsers refuse to load the site, so nothing else in this report matters ` +
            'until it is renewed.', origin));
      } else if (days <= CERT_WARN_DAYS) {
        out.push(f('warn', 'tls-expiring', `The TLS certificate expires in ${days} day(s)`,
          `On ${on}. Usually this means automatic renewal has stopped without anyone noticing — the ` +
            'certificates that lapse are the ones nobody was worried about.', origin));
      }
    }
  }

  // --- Security headers ---------------------------------------------------
  const home = await fetcher.get(base.origin + '/');
  const header = (name) => home.headers.get(name);
  const expected = [
    ['strict-transport-security', 'warn', 'HSTS not set', 'Browsers will try HTTP first on the next visit.'],
    ['x-content-type-options', 'info', 'X-Content-Type-Options not set', 'nosniff stops MIME-type guessing.'],
    ['referrer-policy', 'info', 'Referrer-Policy not set', 'Full URLs leak to third parties by default.'],
    ['content-security-policy', 'info', 'No Content-Security-Policy', 'The strongest defence against injected scripts.'],
  ];
  for (const [name, level, title, detail] of expected) {
    if (!header(name)) out.push(f(level, `header-${name}`, title, detail, home.url));
  }

  // --- Broken internal links ---------------------------------------------
  // Every internal href on every crawled page, checked once.
  const known = new Set(pages.map((p) => p.url.replace(/\/$/, '')));
  // Cloudflare rewrites mailto: links to /cdn-cgi/l/email-protection, which
  // answers 404 to anything that is not a browser running their script. It is
  // not a broken link, it is an anti-spam measure working as designed.
  const notReallyBroken = /\/cdn-cgi\//;
  const seen = new Map(); // target → pages linking to it
  for (const page of pages) {
    for (const href of page.doc?.links.internal ?? []) {
      const clean = href.split('#')[0];
      const bare = clean.replace(/\/$/, '');
      if (known.has(bare) || inSitemap.has(bare) || notReallyBroken.test(clean)) continue;
      seen.set(clean, [...(seen.get(clean) ?? []), page.url]);
    }
  }
  // Both questions below — is the target broken, and is it missing from the
  // sitemap — are answered by the same response, so ask once and read it twice.
  //
  // The fetcher caches, so the old second pass was free for anything already
  // checked. What it was not free for was everything past maxLinkChecks: that
  // pass looped over every target, uncapped and one at a time, so the cap
  // bounded the broken-link check but not the run. A site with 500 link targets
  // paid for 300 serial requests that nothing was capping.
  const all = [...seen.keys()];
  const limit = opts.maxLinkChecks ?? 200;
  const targets = all.slice(0, limit);
  const results = await mapLimit(targets, 6, async (target) => {
    const res = await fetcher.get(target);
    return { target, status: res.status, type: res.headers.get('content-type') ?? '' };
  });

  if (all.length > targets.length) {
    out.push(f('info', 'link-sweep-capped', `${all.length - targets.length} link targets were not checked`,
      `The sweep stops at ${limit} distinct targets. Raise it with maxLinkChecks in the config — ` +
        'the rest of this section describes only what was actually fetched.', origin));
  }

  // Iterated in link order rather than whichever request finished first, so two
  // runs of an unchanged site produce the same report and --baseline stays
  // meaningful.
  for (const { target, status } of results) {
    if (status === 404 || status === 0) {
      out.push(f('error', 'broken-link', 'Link to a page that does not exist',
        `${target} — linked from ${seen.get(target).slice(0, 3).join(', ')}`, seen.get(target)[0]));
    }
  }

  // Linked, reachable, and absent from the sitemap — the mirror image of an
  // orphan, and just as easy to ship by accident when a route is added.
  //
  // Silent when the crawl followed links rather than a sitemap: every page
  // found that way is by definition absent from a sitemap that does not exist,
  // and saying so once per page would bury the finding that matters, which is
  // that there is no sitemap at all.
  const missing =
    opts.bySitemap === false
      ? []
      : results.filter((r) => r.status === 200 && /text\/html/i.test(r.type));
  for (const { target } of missing.slice(0, 20)) {
    out.push(f('warn', 'missing-from-sitemap', 'Page is linked but not in the sitemap',
      `${target} — linked from ${seen.get(target).slice(0, 2).join(', ')}`, target));
  }
  if (missing.length > 20) {
    out.push(f('info', 'missing-from-sitemap-more', `${missing.length - 20} more pages are linked but not in the sitemap`,
      `${missing.length} in total; the first 20 are listed above. This usually means one route or ` +
        'section never made it into the generator’s sitemap, so look for the pattern rather than fixing them one by one.', origin));
  }

  // An internal link that redirects still works, so it is never urgent — but
  // every one of them spends a round trip that a visitor and a crawler both
  // pay for, and they accumulate silently after a URL structure changes.
  // Aggregated and filed as a note: keeping an old permalink alive on purpose
  // is a legitimate reason to have one.
  const redirecting = results.filter((r) => r.status >= 300 && r.status < 400);
  if (redirecting.length) {
    out.push(f('info', 'link-redirects', `${redirecting.length} internal link(s) point at a redirect`,
      `First: ${redirecting.slice(0, 3).map((r) => `${r.target} (${r.status})`).join(', ')}. ` +
        'Linking to the final URL saves the hop.', origin));
  }

  // --- Images that do not load --------------------------------------------
  // The link sweep above reads anchors only, so a broken <img> on page 23 has
  // never been visible to this tool — which is the exact shape of bug it was
  // written for.
  //
  // Deliberately conservative about what counts as broken. A 403 is the
  // signature of hotlink protection working as designed, not of a missing file,
  // and reporting those would be the /cdn-cgi/ mistake a second time.
  const imageSources = new Map();
  for (const page of pages) {
    for (const img of page.doc?.images ?? []) {
      if (!img.src || /^data:/i.test(img.src)) continue;
      let absolute;
      try {
        absolute = new URL(img.src, page.url).toString();
      } catch {
        continue;
      }
      if (!imageSources.has(absolute)) imageSources.set(absolute, page.url);
    }
  }
  const imageLimit = opts.maxImageChecks ?? 200;
  const imageTargets = [...imageSources.keys()].slice(0, imageLimit);
  const imageResults = await mapLimit(imageTargets, 6, async (src) => {
    let res = await fetcher.get(src, { method: 'HEAD' });
    // Some hosts answer HEAD with 405 or 501 and serve the file perfectly well.
    if (res.status === 405 || res.status === 501) res = await fetcher.get(src);
    return { src, status: res.status, error: res.error };
  });
  // In source order, not completion order, so two runs of an unchanged site
  // produce the same report.
  for (const { src, status, error } of imageResults) {
    if (status === 404 || status === 410 || status === 0) {
      out.push(f('error', 'broken-image', 'Image does not load',
        `HTTP ${status || error} for ${src} — used on ${imageSources.get(src)}.`, imageSources.get(src)));
    }
  }
  if (imageSources.size > imageTargets.length) {
    out.push(f('info', 'image-sweep-capped', `${imageSources.size - imageTargets.length} images were not checked`,
      `The sweep stops at ${imageLimit} distinct images. Raise it with maxImageChecks in the config.`, origin));
  }

  // --- hreflang targets load ----------------------------------------------
  // A version that does not load is dropped from the set, and the pages that
  // pointed at it lose the annotation with it. Targets already crawled and
  // answering 200 are not asked again; the interesting ones are the alternates
  // outside the crawl, which is where a stale translation URL survives.
  const crawledOk = new Set(pages.filter((p) => p.res.ok).map((p) => p.url.replace(/\/$/, '')));
  const alternates = new Map();
  for (const page of pages) {
    for (const alt of page.doc?.hreflang ?? []) {
      if (!alt.href || crawledOk.has(alt.href.replace(/\/$/, ''))) continue;
      if (!alternates.has(alt.href)) alternates.set(alt.href, page.url);
    }
  }
  const alternateResults = await mapLimit(
    [...alternates.keys()].slice(0, limit),
    6,
    async (href) => {
      const res = await fetcher.get(href);
      return { href, status: res.status, error: res.error };
    },
  );
  // Grouped by the page that declares them. A translated site tends to carry
  // one alternate per locale, so a single broken page can produce forty
  // identical findings — wordpress.org declares fifty-two locale subdomains for
  // a page that exists in seven of them. One finding per page, naming a few.
  const deadByPage = new Map();
  for (const { href, status, error } of alternateResults) {
    if (status !== 404 && status !== 410 && status !== 0) continue;
    const source = alternates.get(href);
    deadByPage.set(source, [...(deadByPage.get(source) ?? []), `${href} (${status || error})`]);
  }
  for (const [source, dead] of deadByPage) {
    const shown = dead.slice(0, 3).join(', ');
    out.push(f('error', 'hreflang-dead', `${dead.length} hreflang target(s) do not load`,
      `${shown}${dead.length > 3 ? `, and ${dead.length - 3} more` : ''} — declared on ${source}. Each ` +
        'version that does not load drops out of the set, and the pages pointing at it lose the annotation.',
      source));
  }

  // --- Canonical targets --------------------------------------------------
  // A canonical pointing at a redirect or a 404 is worse than none: Google is
  // told the real page lives somewhere that does not answer.
  const canonicals = new Map();
  for (const page of pages) {
    const target = page.doc?.canonical?.[0];
    if (!target) continue;
    if (target.replace(/\/$/, '') === page.url.replace(/\/$/, '')) continue;
    canonicals.set(target, page.url);
  }
  await mapLimit([...canonicals.keys()], 4, async (target) => {
    const res = await fetcher.get(target);
    if (res.status >= 300 && res.status < 400) {
      out.push(f('error', 'canonical-redirects', 'Canonical points at a redirect',
        `${target} answers ${res.status}. Point it at the final URL.`, canonicals.get(target)));
    } else if (!res.ok) {
      out.push(f('error', 'canonical-dead', 'Canonical points at a page that does not load',
        `${target} answers ${res.status}.`, canonicals.get(target)));
    }
  });

  // --- Trailing slashes ---------------------------------------------------
  // Both forms serving 200 is two URLs for one page, and Google will pick one
  // for you. A redirect between them is correct; two live copies are not.
  const sample = pages.filter((p) => p.res.ok && new URL(p.url).pathname !== '/').slice(0, 12);
  let inconsistent = 0;
  await mapLimit(sample, 4, async (page) => {
    const url = new URL(page.url);
    const flipped = url.pathname.endsWith('/')
      ? page.url.replace(/\/$/, '')
      : `${page.url}/`;
    const res = await fetcher.get(flipped);
    if (res.status === 200) inconsistent++;
  });
  if (inconsistent) {
    out.push(f('warn', 'trailing-slash', 'Pages answer with and without a trailing slash',
      `${inconsistent} of ${sample.length} sampled pages load both ways, which is two URLs for one page. ` +
        'One form should redirect to the other.', origin));
  }

  // --- Social images actually load ---------------------------------------
  const ogImages = new Map();
  for (const page of pages) {
    const src = page.doc?.og['og:image'];
    // A relative og:image is reported as og-image-relative by the page checks,
    // which explains the actual problem. Fetching it here would only add a
    // second, vaguer finding about the same tag.
    if (src && /^(https?:)?\/\//i.test(src)) ogImages.set(src, page.url);
  }
  await mapLimit([...ogImages.keys()], 4, async (src) => {
    const res = await fetcher.get(src, { method: 'HEAD' });
    if (!res.ok) {
      out.push(f('error', 'og-image-broken', 'og:image does not load',
        `HTTP ${res.status} for ${src} — shared links will preview blank.`, ogImages.get(src)));
      return;
    }
    const bytes = Number(res.headers.get('content-length') ?? 0);
    if (bytes > 5_000_000) {
      out.push(f('warn', 'og-image-heavy', 'og:image is very large',
        `${(bytes / 1e6).toFixed(1)}MB — some scrapers give up before downloading it.`, ogImages.get(src)));
    }
  });

  return out;
}
