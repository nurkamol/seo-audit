# Roadmap

Ordered by how much a real project would feel the difference, not by how interesting it is to build.

## Next

- **`--against <url>`** — audit a preview deployment and diff it against production directly, no baseline file. The natural shape for a pull-request check.
- **Wait for the edge** — a `--settle` flag that polls until a site serves consistent HTML before crawling. Auditing during a Cloudflare rollout produces a snapshot that is wrong in a confusing way; this has now bitten three separate verifications on one project.
- **Alt-text quality**, not just presence. Nine images all reading "Tantric Massage" pass every existing check and help nobody.
- **`--psi` for a whole section** — sample N pages of a path rather than naming each. Needs care: 12s per URL adds up fast.

## Shipped

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
