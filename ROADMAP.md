# Roadmap

Ordered by how much a real project would feel the difference, not by how interesting it is to build.

## Next

- **`--baseline <file>`** — compare against a previous JSON run and report only what changed. Turns the tool from a report into a regression guard: the useful question is rarely "how many warnings" but "did this deploy break something".
- **`--json <file>`** — machine-readable output. Needed for the baseline above, and for anyone wanting to graph findings over time.
- **`--ignore <id,id>` and a config file** — every site has a rule it lives with on purpose (a short contact page, a canonical pointing elsewhere). Silencing those by hand each run is how a report stops being read.
- **Structured-data expectations** — assert that a page carries the type it should (`Service` on service pages, `BlogPosting` on articles), rather than only checking the JSON parses.

## Later

- **Crawl by following links** when no sitemap exists, instead of stopping. Orphan pages — reachable but not in the sitemap — are worth finding too.
- **Image weight** — flag images that are heavy for their rendered size. Needs the layout, so it means either a headless browser or a `sizes` heuristic; the honest version is not cheap.
- **Alt-text quality**, not just presence. Nine images all reading "Tantric Massage" pass every existing check and help nobody.
- **Redirect map validation** — take a list of old URLs (a migration's `_redirects`) and confirm each still lands somewhere sensible, in one hop. Migrations rot quietly.
- **Multi-site runs** — one command over an agency's whole portfolio, one summary table. The reason this repo is standalone.

## Considered and rejected

- **Measuring performance.** PageSpeed Insights and WebPageTest do it properly, with real browsers, from chosen locations. A `fetch` loop cannot see rendering, and a plausible-looking wrong number is worse than no number.
- **Keyword density and "SEO scores".** Search engines moved past density two decades ago. A score out of 100 invites optimising for the grader rather than the reader — the failure mode these commercial tools encourage.
- **Bundling a headless browser.** It would enable a handful of checks and cost the thing that makes this usable: `npx`, no install, runs anywhere.
- **Ranking or backlink data.** That needs an index and a crawler at a scale this cannot approach. Ahrefs and Search Console already do it, free.
