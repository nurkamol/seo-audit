# Changelog

Notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Added
- `link-sweep-capped` and `missing-from-sitemap-more`, so a sweep that stopped
  early says so. A capped run that stayed quiet described a fraction of the
  site in the voice of a complete audit.
- `maxLinkChecks` is documented, having been readable only from the source.

### Changed
- Broken links are reported in link order rather than whichever request
  finished first, so two runs of an unchanged site produce identical reports
  and `--baseline` stops seeing phantom movement.

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
