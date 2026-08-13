# Roadmap

Ordered by how much a real project would feel the difference, not by how interesting it is to build.

## Next

Empty, and deliberately so. The check table covers what a `fetch` loop can
honestly verify, and the structural work — a portfolio, a crawl that does not
need a sitemap, a redirect map — is done.

What is left in **Later** needs either a headless browser or an index, and both
are refused below for reasons that have not changed. The honest next move is
running this against more real sites and fixing what it gets wrong, which is
how every check here earned its place.

## Shipped

- **A prompt when run with no arguments** (unreleased) — asks for a URL, then prints the one-liner it assembled and runs that. Never fires unless both streams are a terminal.
- **TLS certificate expiry** (unreleased) — a warning inside 14 days, an error after. Reads the certificate without validating it, because an expired one fails the handshake and would otherwise go unreported.
- **Redirect map validation** (1.4.0) — `--redirects` asks the live site for every old URL and reports what actually happens. Wildcard rules are counted, never guessed at.
- **Crawl by following links** (1.4.0) — no sitemap no longer stops the tool. Obeys robots.txt, follows a redirecting homepage, and took mozilla.org from 0 pages audited to a full crawl.
- **Multi-site runs** (1.4.0) — several URLs, or a `sites` array, and the report becomes one table with the worst site first. Per-site overrides, because a portfolio is not a list of interchangeable sites. `--baseline` and `--against` refuse to run across one and say why.

- **hreflang, past reciprocity** (1.3.0) — malformed codes, a missing self-reference, a dead alternate, no `x-default`, and `<html lang="en">` on a page its own hreflang calls `ru`. Found 45 dead alternates on wordpress.org the first time it was pointed at a site that uses hreflang at all.
- **`lastmod` hygiene** (1.3.0) — a generator stamping build time on every URL tells a crawler nothing, so it learns to ignore the field.
- **robots.txt contradicting the sitemap** (1.3.0) — needed a real `Allow`/`Disallow` matcher, longest-match-wins, because the first real file tested against carved three exceptions out of a blocked `/wp-admin/`.

- **Soft 404s** (1.2.0) — a URL that cannot exist must answer 404. Follows the redirect chain, because the first hop says almost nothing.
- **Broken images, `X-Robots-Tag`, relative `og:image`, redirecting internal links** (1.2.0) — the rest of the checks that only fail where nobody looks.

- **Alt-text quality** (1.1.0) — a filename, a placeholder, the same alt on three images, or an alt too long to be read in one breath. Presence was never the interesting half.
- **`--psi` for a whole section** (1.1.0) — `/journal/**` measures a deterministic sample of the pages under a path, and says how many it skipped.

- **`--against <url>`** (1.0.0) — diff a preview deployment against production directly, no baseline file. The natural shape for a pull-request check.
- **Wait for the edge** (1.0.0) — `--settle <seconds>` polls until the site serves consistent HTML before crawling. Auditing during a Cloudflare rollout produces a snapshot that is wrong in a confusing way; it had bitten three separate verifications on one project.

- **`--html`** (0.3.0) — a self-contained report to send a client.
- **`--psi`** (0.3.0) — performance measured by Google, never estimated here.
- **GitHub Action** (0.3.0) — one file to add this to a project.
- **Configurable thresholds** (0.3.0), and **orphan / sitemap-gap detection** (0.3.0).

- **`--json`, `--baseline`, `--update-baseline`** (0.2.0) — regression guard rather than a report.
- **Config file with `ignore` rules** (0.2.0), scoped by check id and URL glob.
- **Structured-data expectations** (0.2.0) — assert a page carries the type it should.
- **Sitemap discovery via robots.txt** (0.2.0) — guessing filenames only finds the conventions you thought of.

## Later

- **Image weight** — flag images that are heavy for their rendered size. Needs the layout, so it means either a headless browser or a `sizes` heuristic; the honest version is not cheap.

## Considered and rejected

- **Measuring performance.** PageSpeed Insights and WebPageTest do it properly, with real browsers, from chosen locations. A `fetch` loop cannot see rendering, and a plausible-looking wrong number is worse than no number.
- **Keyword density and "SEO scores".** Search engines moved past density two decades ago. A score out of 100 invites optimising for the grader rather than the reader — the failure mode these commercial tools encourage.
- **Bundling a headless browser.** It would enable a handful of checks and cost the thing that makes this usable: `npx`, no install, runs anywhere.
- **Ranking or backlink data.** That needs an index and a crawler at a scale this cannot approach. Ahrefs and Search Console already do it, free.
