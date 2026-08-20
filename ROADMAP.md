# Roadmap

Ordered by how much a real project would feel the difference, not by how interesting it is to build.

## Next

Four candidates, queued and not yet started. None of them needs anything this
tool cannot already do, and three of the four need no requests at all.

### Pagination canonicals

Page 2 of an archive canonicalising to page 1. Google's documentation is
explicit that this is wrong, and the consequence is quiet: every page of the
archive after the first leaves the index, and every article reachable only from
those pages loses its way in — the click-depth story one floor up.

Nothing in the repository has heard of pagination. There is no mention of
`page/2`, `?page=` or `rel=next` anywhere in `src/`. Detection costs no
requests and involves no judgement: a crawled URL carrying a pagination segment
whose canonical is that same URL with the segment removed either is or is not
that shape. WordPress, Shopify and several static-site blog templates ship it
turned on.

### The same anchor text on two destinations

The mirror of `anchor-generic`, over the `anchorTexts` that 1.13.0 added.
"Pricing" pointing at `/pricing` on some pages and `/plans` on others tells
Google the two URLs are the same thing, and they compete instead of one of them
winning. The data is already in memory; this costs nothing to run.

`info`, and generic anchors have to be excluded or every "read more" on the
site collides with every other. Expect it to need the same narrowing against
real sites that `link-no-text` took three tries to reach — navigation labels
will produce noise before the shape is right.

### Favicon

Google draws one beside every result a site owns, and a missing or 404 icon
means a generic globe on all of them. One request per domain, in `src/site.mjs`.

The honest version reports only a declared icon that 404s, or no declaration
*and* no `/favicon.ico`. A site serving one from a path it never declared is
fine, and guessing otherwise is the false positive rule 2 forbids.

### Four contradictions, none of them expensive

Each is a fact read off something already parsed, in the voice the rest of the
check table uses:

- `loading="lazy"` and `fetchpriority="high"` on one image — markup telling the
  browser both to defer it and to rush it. `images[].loading` is parsed today
  and read by nothing; `fetchpriority` is two lines of parser away.
- A `Content-Language` header disagreeing with `<html lang>`.
- Schema `datePublished` after `dateModified`, or either one in the future.
- The same URL listed in two files of one sitemap index.

### Three things worth keeping in front of all four

**The room left is not in fetching more, it is in reading what has already been
fetched.** Click depth cost no requests — the link graph had been in memory
since 0.3.0, and only its extreme case, the orphan, was ever reported. The
viewport string has been parsed and kept since the first commit and was only
ever tested for existing. Three of the four candidates above are the same
shape.

**A check is narrowed by real sites, not by argument.** The candidate that
followed from that lesson was anchor text, and 1.13.0 shipped it. It needed the
parser change this section predicted, and then three real sites in a row
produced a false positive before the check found its final shape: a decorative
icon, a thumbnail beside the headline that already names it, and one page
linking to another both with and without a trailing slash. What survived is
quiet across some 12,000 anchors on eight sites and fires on five certificate
PDFs nobody can read. That ratio is the point, not a disappointment. Budget for
it happening again.

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
- **Anything built on `<h2>`, and the absence of a Twitter card.** Both are
  parsed and read by no check, which looked like an opportunity until it was
  examined. Every check `h2` can support is a style opinion — "a long page with
  no subheadings" — and `heading-skip` already reports the structural fact. A
  missing `twitter:card` falls back to Open Graph correctly, so reporting its
  absence would invent a defect. They stay parsed and unread deliberately; that
  is now a decision rather than an oversight.
- **Ranking or backlink data.** That needs an index and a crawler at a scale this cannot approach. Ahrefs and Search Console already do it, free.
