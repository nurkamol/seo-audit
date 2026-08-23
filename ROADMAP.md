# Roadmap

Ordered by how much a real project would feel the difference, not by how interesting it is to build.

## Next

Empty, and this time it stayed empty for more than a day's work. Everything the
professional-tool plan queued has shipped: grouping, ordering by reach, a report
that prints, a local server, a macOS window, two readers compared, and Search
Console.

The one thing waiting is not a feature. **`--search-console` has never made a
live call** — its request shape, token exchange and date window are covered by
tests against a fake API, and nobody here has a property to point it at. The
first person who does should run it before trusting it.

What filled this section before, and is worth keeping in mind when it fills
again: not more checks. There are about ninety, and the ninety-first adds a row
to a report nobody can act on. The plan that just shipped came from one number —
a real store's 2,081 findings across 347 URLs, four checks accounting for 80% of
them and 1,685 under `/products/`, which is not 1,685 problems but one Shopify
template repeated 194 times.

### Five things worth keeping in front of whatever comes next

**The room left is not in fetching more, it is in reading what has already been
fetched.** Click depth cost no requests — the link graph had been in memory
since 0.3.0, and only its extreme case, the orphan, was ever reported. The
viewport string has been parsed and kept since the first commit and was only
ever tested for existing. Ordering by reach was the same shape again: the link
graph had been built twice inside one function and thrown away, and moving it
into `src/graph.mjs` cost nothing and let three things read it.

**A check is narrowed by real sites, not by argument.** Twice now the estimate
has been three or four false positives before a check settles, and twice that
was right. `link-no-text` in 1.13.0 took a decorative icon, a thumbnail beside
the headline that already names it, and a trailing slash. `anchor-ambiguous` in
1.18.0 took file formats as link text, "jump to …" controls, a phrase used
2,730 times in a checksum table, and two URLs that turned out to be one page
behind a 301.

Both ended quiet: one fires on five certificate PDFs nobody can read, the other
on eleven pairs where a reference page and a tutorial chapter carry the same
words. That ratio is the point, not a disappointment. Budget for it happening
again, and budget for the last narrowing being the one that matters — in both
cases it was the one found by checking a finding against the live site rather
than by reading the code.

**A false positive can come from the crawl rather than from a check.** Three
fixes in a row now, none of them in a check: 1.15.0's `page-status` was reading
a rate limit as a broken page and `orphan-page` was reading a fragment as a
site, and 1.16.0's site-level checks were reading a 301's headers as a site's
headers. Every check downstream of a bad fetch inherits it, and the report
gives no sign — 70 pages reported as failing look exactly like 70 pages
failing. When a finding count is implausible, suspect the crawl before the
checks.

**One report on one real site was worth three releases.** 1.15.0 through 1.17.0
came out of a single run against a single store — four fixes, and three of them
defects rather than missing checks: a rate limit read as a broken page, a
fragment read as a site, a 301's headers read as a site's headers, and an image
counted once per size it is served at. None of them was visible from the
fixture suite, all of them had been shipping for versions, and every one was
found by looking at a report someone actually cared about. Ask for those.

**There are two runtimes now**, a standing cost taken on in 1.12.0. A check
that reaches for a Node built-in works in the CLI and disappears in the Worker,
and a report quietly shorter than the CLI's is the same failure as a false
positive wearing the opposite coat. So a check that cannot run in both says
which one it did not run in — and `npx wrangler deploy --dry-run` proving the
bundle still builds is the minimum before calling such a change done.

What is left in **Later** needs either a headless browser or an index, and both
are refused below for reasons that have not changed. Beyond that, the honest
move is still running this against more real sites and fixing what it gets
wrong, which is how every check here earned its place — 1.11.0's guard against
unreadable link graphs exists because eslint.org would otherwise have been
handed 464 findings about navigation that works.

## Shipped

- **Two readers compared** (1.21.0) — `--compare-as`, on what a search
  engine reads rather than on bytes. forbes.com serves Googlebot half the words
  it serves Chrome; nytimes.com differs by 3% and stays silent.
- **Search Console** (1.21.0) — impressions per page, the one number here
  that is not a proxy. Untested against the live API.
- **`--serve` and a macOS app** (1.21.0) — the Worker's own file answers
  `node:http` too, so the local UI is thirty lines of adapter and the Mac app is
  a window around it. Running it for real found the bug reading it would not
  have: the server outlived the app and held the port.
- **A report that prints** (1.21.0) — forced light colours, margins, no
  finding split across a page break, and the causes taking page one.
- **Ordering by reach** (1.21.0) — the link graph moved out of
  `crossPageChecks`, where it was built twice and thrown away, into
  `src/graph.mjs` where three things read it. Causes are ordered by how much of
  the site points at them, and a section stops at two path segments because
  past that a path is a date rather than a template.
- **Crawl as a browser or a crawler** (1.20.0) — `--browser` and `--os`,
  with Googlebot's strings quoted from Google's documentation and impossible
  combinations refused rather than approximated.
- **Findings grouped by cause** (1.20.0) — the same check on pages of one
  section is one piece of work, because that is how a generated site is built.
  A real store's 2,081 findings became 62 things to change, led by "heading
  level jumps from h1 to h3, 225 pages under /products/ — 69% of the crawl".
  Every report format leads with it.
- **Four contradictions** (1.19.0) — an image both deferred and
  prioritised, a `Content-Language` header disagreeing with `<html lang>`,
  structured data modified before it was published or dated in the future, and
  a URL listed twice in one sitemap. The last needed narrowing by shape:
  wordpress.org's image sitemap repeats `/` forty times because that is the
  format, while css-tricks.com's post sitemaps carry image elements and are
  ordinary lists, so the namespace could not be the discriminator.
- **Favicon** (1.19.0) — a declared icon that is not there, or no
  declaration and nothing at `/favicon.ico`. Kept to those two because a site
  serving one from a path it never declared is working as intended. The real
  web added three details: a page at `/favicon.ico` counts as absent, `data:,`
  is a deliberate choice to leave alone, and the plain `icon` is preferred over
  the iOS ones so a stale `apple-touch-icon` does not shout over a working
  favicon.
- **The same anchor text on two destinations** (1.18.0) — `anchor-ambiguous`,
  one phrase pointing at two pages. This section predicted it would be noisy
  before it was right, and four sites each contributed a class of false
  positive: file formats as link text, "jump to …" controls, a phrase used
  2,730 times in a checksum table, and — the one that mattered — two URLs that
  turned out to be one page behind a 301. Both destinations must now be pages
  the crawl actually fetched.
- **The image sweep counts files, not URLs** (1.17.0) — an image CDN
  serves one file at every size asked for, and each size was a separate entry
  against the cap. Measured before believing it, as this section asked: 767
  distinct URLs became 488 distinct files across 45 pages of a real store. A
  third, not the tenfold the mechanism suggested.
- **Site-level checks read the host that answers** (1.16.0) — auditing a
  bare domain whose site lives at `www.` read robots.txt, llms.txt and the
  security headers off the 301, which was three false findings on any such
  site. The homepage's redirect chain is now followed first and the audit moves
  to where it settles, saying so.
- **A rate limit is not a broken page** (1.15.0) — HTTP 429 was reported as
  `page-status` at error level on 70 of one store's 200 crawled pages, which
  were all fine. The crawler now waits it out, believes `Retry-After`, halves
  its concurrency and leaves it down, and reports a page that still refuses as
  `rate-limited` at info. Alongside it, `orphan-page` stopped calling 122 pages
  orphans on a crawl that had seen two-thirds of the site — it now stands down
  on a partial graph, sharing that condition with click depth so the two cannot
  drift apart.
- **Pagination canonicals** (1.14.0) — page 2 of an archive canonicalising
  to page 1, which four of the six real archives tested were doing, including
  wordpress.org's own news blog. The check itself was arithmetic; the work was
  discovering that a sitemap never lists these pages — 0 of 9,273 across three
  sites — so a correct check would have sat dormant. It reads them off the
  internal-link sweep instead, which was already fetching them to see whether
  they resolved and throwing the HTML away.
- **Anchor text** (1.13.0) — the words attached to a link, which the parser
  had been discarding since the first commit, and the only description of a
  page that does not come from the page itself. `link-no-text` for a
  destination nothing names; `anchor-generic` for a page every link to which
  says "read more". Both were narrowed by real sites rather than by argument.
- **An optional hosted front end** (1.12.0) — a password-protected form on the
  reader's own Cloudflare Workers account, for the person who needs an audit
  and will not open a terminal. It imports `audit` and `html` and re-implements
  no check. Deliberately off the main path: the CLI is free, has no ceiling,
  and runs the two certificate checks the Worker cannot. It refuses to audit
  anything until a secret is set, because deploying is one click and an open
  crawler on someone's account is not an acceptable default for the gap. Costs
  and risk are stated first rather than in a footnote, in `docs/hosting.md` —
  including that Cloudflare's free plan cannot run it at all.
- **Click depth** (1.11.0) — how many links from the homepage every page
  actually is, over the graph the crawl already built, with the shortest route
  printed alongside the number. `orphan-page` had been reporting the extreme of
  this shape since 0.3.0 and nothing reported the common one. Declines to
  measure rather than guess when the crawl was truncated, or when a JavaScript
  navigation leaves most pages with no path through the HTML.
- **A canonical pointing at a noindexed page** (1.11.0) — the sweep already
  fetched and parsed the target to check it was not a redirect or a 404, and
  never read what it says about indexing. Both pages leave the index, and the
  page that started it has faultless markup.
- **A viewport that blocks zooming, or fixes a pixel width** (1.11.0) — the tag
  was checked for existing and never read. Safari has ignored `user-scalable=no`
  since iOS 10, which is why it survives on sites whose owners tested on an
  iPhone.

- **A prompt when run with no arguments** (1.5.0) — asks for a URL, then prints the one-liner it assembled and runs that. Never fires unless both streams are a terminal.
- **TLS certificate expiry** (1.5.0) — a warning inside 14 days, an error after. Reads the certificate without validating it, because an expired one fails the handshake and would otherwise go unreported.
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
  1.14.0 put a number on what that costs. `canonical-paginated` reads page 2
  of an archive off the link sweep, which only sees pagination that is in the
  HTML — and css-tricks.com, wordpress.org/news and blog.mozilla.org all have
  the bug *and* link their pagination with JavaScript, so a full audit of
  those three cannot reach it, even though pointing the tool straight at
  `/page/2/` reports it immediately. That is the trade, stated plainly: a
  known blind spot rather than a bug, and still cheaper than the install.
- **Anything built on `<h2>`, and the absence of a Twitter card.** Both are
  parsed and read by no check, which looked like an opportunity until it was
  examined. Every check `h2` can support is a style opinion — "a long page with
  no subheadings" — and `heading-skip` already reports the structural fact. A
  missing `twitter:card` falls back to Open Graph correctly, so reporting its
  absence would invent a defect. They stay parsed and unread deliberately; that
  is now a decision rather than an oversight.
- **Ranking or backlink data.** That needs an index and a crawler at a scale this cannot approach. Ahrefs and Search Console already do it, free.
