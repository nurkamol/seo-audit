# Roadmap

Ordered by how much a real project would feel the difference, not by how interesting it is to build.

## Next

The check table is in good shape. What is left is structural — changes to what
the tool *is*, not to what it looks for.

- **Multi-site runs** — one command over a portfolio, one summary table. The only item here that compounds rather than adding a row to the check table, and the reason this repo is standalone.
- **Crawl by following links** — a site with no sitemap currently stops the tool dead. Following links would audit it anyway, and would find orphans that no sitemap ever mentions.
- **Redirect map validation** — take a migration's `_redirects` and confirm each old URL still lands somewhere sensible in one hop. Migrations rot quietly.
- **TLS certificate expiring** — a warning under 14 days, zero-dependency via `node:tls`. Not strictly SEO, but nothing else on this list takes a site down completely.
- **A prompt when run with no arguments** — currently prints help and exits 2. It could ask for a URL and then print the flag invocation it is about to run, so it teaches the CLI rather than hiding it. Gated on `stdin.isTTY`, so CI never sees it.

## Shipped

- **hreflang, past reciprocity** (unreleased) — malformed codes, a missing self-reference, a dead alternate, no `x-default`, and `<html lang="en">` on a page its own hreflang calls `ru`. Found 45 dead alternates on wordpress.org the first time it was pointed at a site that uses hreflang at all.
- **`lastmod` hygiene** (unreleased) — a generator stamping build time on every URL tells a crawler nothing, so it learns to ignore the field.
- **robots.txt contradicting the sitemap** (unreleased) — needed a real `Allow`/`Disallow` matcher, longest-match-wins, because the first real file tested against carved three exceptions out of a blocked `/wp-admin/`.

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

- **Crawl by following links** when no sitemap exists, instead of stopping. Orphan pages — reachable but not in the sitemap — are worth finding too.
- **Image weight** — flag images that are heavy for their rendered size. Needs the layout, so it means either a headless browser or a `sizes` heuristic; the honest version is not cheap.
- **Redirect map validation** — take a list of old URLs (a migration's `_redirects`) and confirm each still lands somewhere sensible, in one hop. Migrations rot quietly.
- **Multi-site runs** — one command over an agency's whole portfolio, one summary table. The reason this repo is standalone.

## Considered and rejected

- **Measuring performance.** PageSpeed Insights and WebPageTest do it properly, with real browsers, from chosen locations. A `fetch` loop cannot see rendering, and a plausible-looking wrong number is worse than no number.
- **Keyword density and "SEO scores".** Search engines moved past density two decades ago. A score out of 100 invites optimising for the grader rather than the reader — the failure mode these commercial tools encourage.
- **Bundling a headless browser.** It would enable a handful of checks and cost the thing that makes this usable: `npx`, no install, runs anywhere.
- **Ranking or backlink data.** That needs an index and a crawler at a scale this cannot approach. Ahrefs and Search Console already do it, free.
