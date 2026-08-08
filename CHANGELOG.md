# Changelog

Notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/nurkamol/seo-audit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nurkamol/seo-audit/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/nurkamol/seo-audit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/nurkamol/seo-audit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nurkamol/seo-audit/releases/tag/v0.1.0
