# Changelog

Notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.2] — 2026-08-14

### Fixed
A second sweep, against gov.uk, blog.cloudflare.com, smashingmagazine.com,
nextjs.org and python.org. 41 errors reported; 22 of them were the tool's fault.

- **`robots-blocks-all` did not read groups.** It tested for a `Disallow: /`
  line and a `User-agent: *` line existing *somewhere* in the file, which are
  routinely different groups. gov.uk blocks `deepcrawl` and python.org blocks
  `HTTrack`; both were reported as blocking their entire site from everyone, at
  error level. It now asks `src/robots.mjs` — the correct matcher that had been
  sitting unused since 1.3.0 — whether Googlebot may fetch `/`.

- **Markup built inside a `<script>` was read as page content.**
  smashingmagazine.com's offline-article list assembles `<li><a href="'+a.url+'">`
  by string concatenation, and ten pages were reported as linking to a page that
  does not exist. Elements are now read from markup with `<script>` and
  `<style>` contents removed. JSON-LD is still read from the original, because
  it lives inside a script.

- **Unquoted attribute values were invisible.** HTML permits `name=viewport`
  without quotes and minifiers emit it; `attr()` read only quoted and bare
  forms, so smashingmagazine.com had ten pages reported as having no viewport
  meta at all.

Fixing the last two revealed three findings that had been masked, each verified
by hand: gov.uk really does list `/search/all` in its sitemap while `robots.txt`
disallows it, and smashingmagazine.com's canonicals really do point at URLs that
301 elsewhere. Reading an unquoted attribute is what made that canonical
visible in the first place.

### Upgrading
Worth taking promptly, for the same reason as 1.5.1: `robots-blocks-all` is an
**error**, and 1.5.1 raised it on any site whose robots.txt blocks a single
badly-behaved crawler in its own group — telling people their whole site is
unindexable when it is not.

The parser fixes remove far more findings than they add, but they do add some:
a page whose `<meta name=viewport …>` was unquoted stops reporting a missing
viewport and starts being checked properly, so a canonical or a description that
was invisible can now produce a finding of its own. Those are real, and were
being missed rather than newly introduced.

## [1.5.1] — 2026-08-14

### Fixed
Three false positives, all found by running 1.5.0 against five real sites and
checking every error it reported. Ten errors across those sites; six were the
tool's fault.

- **`mixed-content` fired on ordinary hyperlinks.** It matched any
  `href="http://…"`, so `<a href="http://old-friend.test/">` and an RSS
  `<link rel="alternate">` were reported as insecure resources — at error level,
  on wordpress.org, developer.mozilla.org and vite.dev, every instance an
  outbound link to somebody else's site. Mixed content means a subresource the
  browser *loads*: `src` on img, script, iframe, video and friends, and `href`
  on a stylesheet link. A hyperlink is not one, and a browser does nothing about
  it.

- **Markup inside an attribute value was read as part of the page.**
  astro.build stores an entire Astro component in a `data-code` attribute for
  its copy button, and the `<img src={product.imageUrl}>` inside that string was
  reported as an image with no alt. Attribute values containing whole tags are
  now blanked before anything is extracted — narrowly, so `title="a < b"` and a
  meta description containing a `<` are untouched.

- **`role="presentation"` now counts as declaring an image decorative**, the
  same as `alt=""`. It is the ARIA way of saying it, screen readers honour it,
  and mozilla.org's accessibility team ships it — which is about as good as
  evidence gets that it is a deliberate choice rather than an oversight.
  Reporting a deliberate choice as an error is how a report gets ignored.

Also: an `<img>` with neither `src` nor `alt` described itself as `First: null`.

### Upgrading
Worth taking promptly if you run `--fail-on error` in CI. `mixed-content` is an
**error**, and 1.5.0 raised it on any `<a href="http://…">` — which means a
build could be failing over an outbound link to somebody else's site. This
release only ever removes findings; nothing new is reported.

## [1.5.0] — 2026-08-14

### Added
- **Running the bare command asks for a URL** instead of printing help and
  exiting 2. It asks two questions, then prints the one-line command it
  assembled and runs that — the point is to teach the flags, not to hide them
  behind a menu, so the second use needs no questions at all.

  Only when both stdin and stdout are a terminal. In CI, in a pipe, under
  `| tee`, or in an editor's task runner, the help text is still the answer: a
  prompt that blocks a build waiting for input nobody can type is much worse
  than the help it replaced. There is a test that spawns the binary with a
  closed stdin and asserts it exits rather than waiting.

- **TLS certificate expiry** — `tls-expiring` (warning) inside 14 days,
  `tls-expired` (error) after. Not an SEO check, and the only thing in this tool
  that takes a site off the internet completely: a browser refuses to load an
  expired certificate, at which point nothing else in the report matters. The
  certificates that lapse are the ones nobody was worried about, which is why
  two weeks of notice is the useful amount.

  The inspecting connection sets `rejectUnauthorized: false`, deliberately and
  only here. An expired certificate fails the handshake, so a validating
  connection cannot read the one fact this exists to report — the check would go
  silent in exactly the case it is for. Nothing is sent over the socket, and
  nothing is read but the certificate's dates, which are the ones a browser
  would show. Verified against `expired.badssl.com`, which reads as 4141 days
  past expiry rather than as an unreadable host.

### Upgrading
`@v1` moves forward. No flag renamed, no config key changed, and a scripted run
behaves exactly as before.

`tls-expired` is a new error, but it only fires on a certificate that has
already expired — at which point browsers are refusing to load the site and a
red build is the least of it. `tls-expiring` is a warning with two weeks of
notice.

The no-argument prompt only appears when both stdin and stdout are a terminal.
Anything scripted, piped or running in CI still gets the help text and exit 2.

## [1.4.0] — 2026-08-14

Three changes to what the tool audits, rather than to what it checks for.

### Added
- **`--redirects <file>` checks a migration's redirect map** against the live
  site. A map is written once, verified once, and then rots: a later change to a
  destination turns an entry into a hop through a 404, and nothing tells anyone.
  The old URLs carry the links and the rankings, which makes this one of the few
  SEO failures that is both expensive and completely silent.

  Reads the Netlify `_redirects` shape, which is also what people write by hand,
  with `to` and the status both optional. Reports `redirect-dead` and
  `redirect-broken` as errors, and `redirect-not-applied`, `redirect-hops`,
  `redirect-elsewhere` and `redirect-temporary` as warnings. A rule that works
  in one hop reports nothing.

  Rules with a `*` or a `:placeholder` match a shape rather than a URL, so
  asking for them literally proves nothing — they are counted and reported
  rather than guessed at. Findings are aggregated by outcome, because a
  migration map runs to hundreds of entries and one finding each would be a wall
  nobody reads. `maxRedirectChecks` bounds the work and says when it bites.

- **A site with no sitemap is crawled by following links**, instead of stopping
  dead. The sites least likely to have been looked after were exactly the ones
  this refused to look at. `www.mozilla.org` went from 0 pages audited to a full
  crawl with 20 distinct checks firing.

  The crawl obeys `robots.txt` — a crawler that ignores it is rude, and here it
  would also spend the budget on the pages nobody wants indexed. It skips
  assets, and treats two URLs redirecting to one page as one page.

  It also follows a redirecting homepage, which real sites forced: `/` on
  `www.mozilla.org` answers 302 to `/en-US/`, and reading only the first hop
  finds a redirect with no links in it and concludes the site has one page.
  This is the one place in the tool that follows redirects rather than
  reporting them, because a link crawl has to land where a visitor lands.

- **Multi-site runs.** `seo-audit one.example two.example` — or a `sites` array
  in the config — audits a portfolio and prints one table, worst site first.
  This is the question a per-site report can never answer, because each report
  only ever sees its own site.

  A `sites` entry may be a bare URL or an object carrying its own settings,
  because a portfolio is not a list of interchangeable sites: one has a
  deliberately short contact page, another has no journal to expect
  `BlogPosting` on. Overrides land on top of the shared config, and `ignore`
  accumulates rather than replacing — a portfolio-wide rule and a site rule are
  both meant to apply. URLs on the command line replace the configured list
  entirely, which is how you audit a subset of a portfolio.

  `--md` and `--html` write one file with the table on top and each site's full
  report underneath, so a section can be lifted out and sent to whoever owns
  that site. `--json` writes one object with a `sites` array. The run exits 1 if
  **any** site fails: a portfolio check that passes while a site in it is broken
  is a check nobody can trust.

  Sites are audited one at a time. Interleaved progress from twenty hosts is
  unreadable, and each audit is already parallel inside itself.

  `--baseline`, `--against` and `--update-baseline` compare a site against
  itself, so with more than one site they refuse to run and say why rather than
  half-answering. The baseline file format is single-site; a portfolio
  regression guard needs a format that holds several, and that is its own piece
  of work.

  Nothing changes for a single site — same output, same exit code, same flags.

### Changed
- `no-sitemap` is a **warning** rather than an error. It used to mean "there is
  nothing here to audit", which was true and is not any more. A missing sitemap
  is worth saying and is rarely worth failing a build over, now that the pages
  get checked anyway. A site that has no sitemap *and* serves no crawlable
  homepage reports `nothing-crawlable`, which is an error.
- `missing-from-sitemap` is silent during a link crawl. Every page found that
  way is absent from a sitemap that does not exist, and saying so once per page
  would bury the finding that matters.

### Upgrading
`@v1` moves forward: no flag renamed, no config key changed, and a single-site
run behaves exactly as before.

Two things to know if you script this tool:

- **Extra positional arguments used to be ignored and now mean something.**
  `seo-audit a.example b.example` audited only the first; it now audits both and
  prints a portfolio table. If you were passing stray arguments and relying on
  them being dropped, they will be crawled. Combined with `--baseline`,
  `--against` or `--update-baseline`, a second URL now exits 2 with an
  explanation rather than quietly auditing one site.
- **`no-sitemap` went from error to warning**, which can only turn a red build
  green. The pages are audited either way now. A site that is genuinely
  un-auditable reports `nothing-crawlable`, which is an error.

New errors are otherwise confined to things you opt into: `redirect-dead` and
`redirect-broken` only appear with `--redirects`.

## [1.3.0] — 2026-08-13

The checks that only fail on translated pages and in generated files.

### Added
- **robots.txt contradicting the sitemap** (`robots-blocks-sitemap-url`, error).
  The sitemap asks Google to index a URL while robots.txt forbids fetching it,
  so it lands in the index with no description, or not at all. One of the two
  files is wrong, and nothing about either one on its own looks wrong.

  This needed a real robots.txt reader rather than a regex, in `src/robots.mjs`.
  `Allow` and `Disallow` are not first-match-wins: the longest pattern wins and
  a tie goes to `Allow`. A `Disallow`-only implementation would have reported
  every site that carves an exception out of a broad block — which is what
  wordpress.org does, and it was the first real file tested against. Wildcards
  and the trailing `$` anchor are honoured, an empty `Disallow:` blocks nothing,
  and a `googlebot` group takes precedence over the `*` group.

  Skipped entirely when `robots-blocks-all` has already fired, which would
  otherwise restate the same problem once per URL.

- **`lastmod` hygiene.** `sitemap-lastmod-missing` (note), `-identical` (note)
  and `-future` (warning). The interesting one is `identical`: a generator
  stamping build time on every URL looks diligent and is worth nothing, because
  the dates never distinguish one page from another and crawlers stop reading
  them. It needs five dated URLs before it will say so — a five-page brochure
  site genuinely does get rebuilt all at once. `future` allows a day of slack,
  since a build machine with a skewed clock is a different problem.

  `parseSitemap` gained an `entries` array pairing each `<loc>` with its own
  `<lastmod>`, read from inside the `<url>` block so a date cannot drift onto a
  neighbour. `urls` is unchanged and still a list of strings — every caller
  wants exactly that, and changing it would have rippled through discovery for
  no gain.

- **hreflang, past reciprocity.** Reciprocity was the hard part and was already
  covered; these are the rest, and they only ever fail on translated pages —
  which is to say, on the pages a homepage grader never opens.

  - `hreflang-invalid` (error) — a malformed code. Only the *shape* is checked,
    never whether the codes exist: validating against ISO lists would mean
    embedding them, and a stale list is worse than no check. The shape alone
    catches the common slip, which is `en_US` with an underscore.
  - `hreflang-no-self` (warn) — a set that lists every translation except the
    page it is on, leaving the set incomplete.
  - `hreflang-lang-mismatch` (warn) — `<html lang="en">` on a page its own
    hreflang calls `ru`. Google reads both, and one of them is wrong. Dialects
    are not contradictions: `lang="en"` with `hreflang="en-GB"` is the same
    claim, and only the primary subtag is compared.
  - `hreflang-no-x-default` (note) — reported once for the site rather than on
    every page, because on a translated site the answer is the same everywhere.
  - `hreflang-dead` (error) — an alternate that does not load, including
    versions outside the crawl, which is where a stale translation URL survives
    unnoticed. Grouped by the page that declares them: wordpress.org names 52
    locale subdomains for a page that exists in 7 of them, which as one finding
    per target would have been 45 lines saying the same thing.

### Upgrading
Nothing renamed, no exit code or config shape changed, so `@v1` moves forward.
As in 1.2.0, two of these are **errors** — `hreflang-dead` and
`robots-blocks-sitemap-url` — so `--fail-on error` can turn red on a site that
has not changed. Both are contradictions rather than judgement calls: a
translation that does not load, and two files disagreeing about whether a page
should be crawled. `--fail-on new` with a `--baseline` keeps a build green while
the backlog is worked through.

Sites with no translated pages and no `Disallow` rules will see nothing new
except possibly a `lastmod` note.

## [1.2.0] — 2026-08-13

### Added
- **Soft 404s** (`soft-404`). A URL that cannot exist has to answer 404; when it
  answers 200 instead, every typo, stale inbound link and crawler guess becomes
  an indexable copy of the error page. Nothing on a site reveals this — you have
  to ask for something missing, which no visitor and no single-page grader does.

  The probe follows the redirect chain and judges only the final answer, which
  real sites forced: wikipedia.org answers `301 → 404`, which is correct and
  must stay silent, while vercel.com answers `308 → 307 → 307 → 200` — a
  trailing-slash normalisation ending in a soft 404 that reading the first hop
  would miss completely. Landing on the homepage is reported separately, and a
  soft 404 carrying `noindex` is a warning rather than an error, because the
  damage stops at the index.

- **`X-Robots-Tag: noindex`** (`x-robots-noindex`). The same instruction as the
  meta tag, sent as a header — invisible in the HTML, so it survives every
  review of the markup, and binding on Google exactly as hard.

- **Broken images** (`broken-image`). The link sweep read anchors only, so a
  404ing `<img>` on page 23 has never been visible to this tool, which is the
  precise shape of bug it was written for. Deliberately conservative: only
  404, 410 and a dead connection count. A 403 is hotlink protection working as
  designed, and reporting those would repeat the `/cdn-cgi/` mistake. A host
  that rejects `HEAD` with 405 or 501 is retried with `GET` before judgement.

- **Relative `og:image`** (`og-image-relative`). Open Graph requires an absolute
  URL; a scraper has no page context to resolve `/og.jpg` against, so the
  preview comes out blank while the markup looks perfectly reasonable.
  Protocol-relative URLs are accepted, because scrapers do resolve them.

- **Internal links that redirect** (`link-redirects`, note). Aggregated into one
  finding, since keeping an old permalink alive on purpose is legitimate.

- **Capped sweeps say so.** `link-sweep-capped`, `image-sweep-capped` and
  `missing-from-sitemap-more`. A truncated run that stayed quiet described a
  fraction of the site in the voice of a complete audit.

- `maxImageChecks` bounds the image sweep. `maxLinkChecks` is now documented,
  having been readable only from the source — which stopped being acceptable
  the moment a finding started telling people to raise it.

### Changed
- Broken links and broken images are reported in source order rather than
  whichever request finished first, so two runs of an unchanged site produce
  identical reports and `--baseline` stops seeing movement that is not there.

### Fixed
- `maxLinkChecks` now bounds the whole link sweep, not just half of it. The
  broken-link pass respected the cap while the "linked but not in the sitemap"
  pass looped over every target, uncapped and one request at a time — so on a
  site with 500 link targets, 300 serial requests happened that nothing was
  limiting. Both questions are now answered from one pass.

  The two passes were never fetching the same URL twice: `Fetcher` caches by
  method and URL, so anything the first pass had already asked for was free.
  What was not free was everything past the cap, which the first pass had never
  requested.

### Upgrading
Nothing renamed, no exit code or config shape changed, so `@v1` moves forward.
Read this one before upgrading a build that is currently green, though: unlike
1.1.0, several of these checks are **errors**, so `--fail-on error` — the
default — can turn red on a site that has not changed. `soft-404` is the likely
one, because returning 200 for unknown URLs is the default behaviour of several
popular hosts and frameworks.

That is the check doing its job, and it is worth fixing rather than silencing.
If you need the build green while you get to it, `--fail-on new` with a
`--baseline` tolerates the backlog you already have and fails only on a
regression, which is what it was built for. `--ignore soft-404` is the blunter
option.

## [1.1.0] — 2026-08-13

### Added
- **Alt-text quality**, not just presence. Nine images sharing one alt text
  passed every previous check and helped nobody. Four new checks: `alt` that is
  really a filename (`img-alt-filename`), `alt` that names the medium rather
  than the content (`img-alt-placeholder`), three or more images sharing one
  `alt` (`img-alt-duplicate`), and `alt` too long to be read in one breath
  (`img-alt-long`).

  `alt=""` is still never judged — it is the correct, deliberate way to mark a
  decorative image, and treating it as a defect would punish sites for getting
  it right. Repeated alt starts at three images rather than two, because a
  gallery of near-identical product shots is a fair reason for two.

- **`--psi` takes a section**, not just a list of pages. `--psi "/journal/**"`
  measures a sample of the crawled pages under a path instead of making you
  name each one. `--psi-sample <n>` sets how many, default 3.

  The sample is spread across the section rather than taken off the front, so a
  template regression late in a section is not missed, and it is deterministic,
  so `--baseline` compares like with like instead of reporting the sample
  itself as a change. When a glob matches more pages than were measured, the
  report says so: a silent cap would read as a clean bill of health for a
  section that was mostly never looked at.

### Changed
- `psi` paths in a config file are now resolved against the origin the crawl
  settled on, rather than the target string as typed. Same result for an
  ordinary run; correct for one that was given a bare hostname.

### Upgrading
Nothing renamed, no exit code or config shape changed, so `@v1` moves forward
to this release. One thing to expect: `img-alt-filename` and
`img-alt-placeholder` are **warnings**, so a build running `--fail-on warn` can
turn red on a site that has not changed. That is the new checks finding
something real, but it will arrive as a surprise. `--fail-on new` with a
baseline exists for exactly this — it tolerates the backlog you already have
and fails only on a regression.

## [1.0.1] — 2026-08-08

### Fixed
- A host that accepts the TLS handshake and then never answers is now reported
  as **unreachable**, with the likely cause, instead of "No sitemap found".
  Bot protection stalling non-browser clients is a completely different
  problem from a missing sitemap, and the old message sent people to look in
  the wrong place.
- Discovery gives up after three timeouts against a host that has never once
  answered, rather than paying the full timeout for every candidate. A
  tarpitting host now fails in about a minute instead of four.
- "No sitemap found" lists every location that was actually tried, so the fix
  is obvious.

### Added
- `--user-agent <ua>`, for hosts that block on the user agent.

## [1.0.0] — 2026-08-08

The first version meant for other people's projects.

### Added
- **A test suite** — 42 tests over `node:test`, no install, serving their own
  fixture site on localhost so they run offline and cannot be broken by a real
  site changing. Writing them immediately found a parsing bug: `\b` treats the
  hyphen in `data-src` as a word boundary, so a lazy-loading site had its
  `data-src` read as `src`.
- CI on Node 18, 20 and 22.
- `--against <url>` — compare two deployments directly, hosts ignored. A
  preview against production, without a baseline file.
- `--settle <seconds>` — wait until a site serves consistent HTML before
  crawling. A CDN rolls a deploy out unevenly, and a crawl during that window
  produces a snapshot that is wrong in a way nobody can reproduce. This misled
  three verifications on one project before it became a feature.
- `--version`.
- Retries for transient failures, and deliberately none for a refused
  connection or an unknown host, which are answers rather than blips.
- New checks: heading hierarchy (scoped to `<main>`, so footer furniture does
  not count), canonical targets that redirect or 404, trailing-slash
  inconsistency, URL hygiene (uppercase, underscores, spaces), and a missing
  charset declaration.
- Action: sticky pull-request comments, `notes` and `pages` outputs, and a
  `settle` input.
- `CONTRIBUTING.md`, `SECURITY.md`, issue templates, and a README written for
  someone who has never seen the tool.

### Fixed
- **The Action ran `main` regardless of the version referenced**, so pinning
  `@v1` pinned nothing. It now runs the code shipped with that version.
- `--limit` made every uncrawled page look like it was missing from the
  sitemap. The check now compares against the full sitemap, not the subset
  that was crawled.
- Attribute matching no longer confuses `data-src` with `src`.

### Notes
- `v1` is a compatibility promise: flags, exit codes, the JSON shape and the
  config format will not change under it.

## [0.3.0] — 2026-08-08

### Added
- `--html <file>` — a self-contained HTML report. One file, no assets, light
  and dark aware, prints cleanly: the format you send to a client.
- `--psi <urls>` — performance, measured by Google rather than estimated here.
  Returns the performance score, LCP and CLS against Google's own good/poor
  thresholds, every opportunity worth 250ms or more in Google's words, and the
  Chrome field data when a site has enough traffic — which is the number that
  actually counts for ranking. ~12s per URL, so it takes a list of pages, never
  the sitemap, and never runs by default. Key read from `PSI_API_KEY` or
  `~/.config/seo-audit/.env`.
- `--psi-strategy mobile|desktop`.
- **GitHub Action** (`uses: nurkamol/seo-audit@main`) — writes a job summary
  table, exposes `errors` and `warnings` as outputs, leaves the HTML report as
  an artifact. Adding this to a project is now one file.
- `limits` in the config: `titleMin`, `titleMax`, `descMin`, `descMax`,
  `thinWords`, `slowMs`. A documentation site and a shop disagree about what
  "thin" means and the tool should not hold the opinion.
- Orphan detection — pages in the sitemap that nothing links to, so they
  collect no internal authority.
- The mirror image: pages linked from the site but missing from the sitemap.

## [0.2.0] — 2026-08-08

Turns the report into a regression guard.

### Added
- `--json <file>` — machine-readable output, and the format a baseline uses.
- `--baseline <file>` — compare against a previous run and report only what
  changed: fixed, new, unchanged. `--fail-on new` fails a build on a
  regression while tolerating the backlog you already know about, which is
  what keeps the check from being switched off in week two.
- `--update-baseline` — rewrite the baseline after comparing.
- Configuration file (`seo-audit.config.json`, or `--config`): `ignore` rules
  by check id, optionally scoped to URL globs, so findings a site has decided
  to live with stop drowning the ones that matter. `*` stops at a slash, `**`
  does not.
- `--ignore <ids>` for silencing a check for a single run.
- `expect` in the config: assert that a group of pages carries the schema
  types it should. The difference between "the JSON-LD parses" and "this
  article is actually marked up as an article" — it catches a template
  quietly dropping its structured data.
- The run summary reports how many findings were ignored, so a config that
  hides too much is visible rather than silent.

### Fixed
- Sitemap discovery reads the `Sitemap:` line in `robots.txt` before guessing
  filenames, and follows redirects. Guessing alone missed Yoast's
  `/sitemap_index.xml` on the first WordPress site it met.
- Cloudflare's `/cdn-cgi/l/email-protection` links are no longer reported as
  broken. They answer 404 to anything that is not a browser, by design.

## [0.1.0] — 2026-08-08

First working version.

### Added
- Sitemap crawler with a concurrency cap and a per-URL response cache, so no
  page is fetched twice however many checks want it.
- Per-page checks: status and redirects, `noindex`, title, meta description,
  `h1`, `lang`, viewport, canonical, Open Graph tags, `og:image` format,
  JSON-LD validity, image `alt`, image dimensions, `srcset`, word count,
  in-content links, mixed content.
- Cross-page checks: duplicate titles, duplicate descriptions, and `hreflang`
  reciprocity — Google drops one-way pairs, and nothing on a single page can
  reveal that.
- Site-wide checks: `robots.txt`, `llms.txt`, host and scheme redirect hops,
  security headers, a full internal-link sweep for 404s, and whether every
  `og:image` actually loads.
- Terminal report grouped by check, and a Markdown report for committing,
  diffing between runs, or sending to a client.
- `--fail-on error|warn|never` with a matching exit code, for CI.

### Notes
- Performance is out of scope on purpose — see the README.
- Zero dependencies: Node 18+ and nothing else, so `npx` works on a bare machine.

[Unreleased]: https://github.com/nurkamol/seo-audit/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/nurkamol/seo-audit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nurkamol/seo-audit/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/nurkamol/seo-audit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/nurkamol/seo-audit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nurkamol/seo-audit/releases/tag/v0.1.0
