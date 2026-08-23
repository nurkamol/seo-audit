# Changelog

Notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.17.0] — 2026-08-23

### Changed
- **The image sweep counts files, not URLs.** An image CDN serves one file at
  every size asked for — `photo.avif?v=17&width=150`, `&width=300`, `&width=750`
  — and each of those was a separate entry against the 200-image cap, and a
  separate request. `width`, `height`, `w`, `h` and `dpr` are now dropped before
  deduping.

  Measured rather than assumed, because the roadmap entry asking for this said
  to: across 45 pages of a real store, **767 distinct URLs became 488 distinct
  files**, a third of the sweep asking the same question again. A live run of
  the same 45 pages now reports 488 where it used to report 767. It is not the
  tenfold saving the mechanism suggested, and the honest number is the one
  worth writing down.

  `v` is deliberately kept. A different version is a different asset and a
  stale one really can 404, which is a finding worth keeping. The trade taken
  is that one size is checked on behalf of the others: a CDN that refuses an
  unusual width will not be caught, which errs towards saying nothing rather
  than towards saying something wrong.

- **Both capped messages name the number to set.** `image-sweep-capped` now
  says how many files the site has and what to set `maxImageChecks` to;
  `truncated` says `--limit 325` rather than "raise it with --limit". The
  report already knew both numbers.

## [1.16.0] — 2026-08-23

### Fixed
- **Site-level checks are read on the host that answers.** Auditing
  `example.com` when the site lives at `www.example.com` left `origin` on the
  host that only ever returns 301, while the crawl followed the redirect for
  pages — `discover()` has always used `chain()`. So robots.txt, llms.txt and
  every response header were read off a redirect.

  On a real store that meant three findings, none of them true: a flat "No
  robots.txt" for a site with a good one — agent instructions, a UCP endpoint,
  the lot — an llms.txt reported missing on a host that does not serve it, and
  a `Referrer-Policy` verdict taken from a 301's headers.

  The homepage's redirect chain is now followed before anything else, and where
  it settles on another host the audit moves there and says so as
  `origin-redirected`. That is what a crawler does: RFC 9309 asks for at least
  five redirects to be followed for robots.txt, and Google follows them.

  Re-running that store from its bare domain: `robots-missing` and
  `llms-missing` both went silent, and the one real finding of the three —
  no `Referrer-Policy` — is now reported against `https://www.…` and read from
  a response that actually exists. The host-variant check is unaffected: it
  strips `www.` before building its variants, so it tests the same three
  either way.

## [1.15.0] — 2026-08-23

### Fixed
- **A rate limit is no longer reported as a broken page.** A Shopify store
  answered HTTP 429 to **70 of its 200 crawled pages** at the default
  concurrency, and every one came back as `page-status` — "Page did not return
  200", at error level. The pages were fine. Requested eight seconds apart the
  same URLs answered 200, on the tool's own user agent, so it was the crawl's
  speed and nothing else.

  `src/http.mjs` treated any status under 500 as a final answer, so a 429 was
  never retried. Now it is: the run pauses globally, honours `Retry-After`
  where it is sent — Shopify sends none, hence a default that doubles to a
  ceiling of eight seconds — and **halves the concurrency and leaves it down**,
  because retrying a rate limit at the speed that caused it just spends the
  budget again. After twenty refusals it stops asking, so a host that means it
  costs a slow finish rather than an hour.

  A page that still answers 429 is reported as `rate-limited` at **info**: the
  server described the crawl, not the page. It is also no longer counted as
  "not indexable" — a page nobody could fetch has unknown indexability, and
  "not indexable" is an answer.

- **Orphans are not looked for across a crawl that did not see the site.** The
  same report called **122 pages orphans** while, three findings further down,
  declining to measure click depth because the link graph was a fragment. Both
  read the same graph. One check refusing to answer while its neighbour answers
  confidently from the same data is not a defensible position.

  `orphan-page` now stands down when the crawl was truncated by `--limit`, or
  when more than a tenth of the crawled pages did not load, and says so once as
  `orphan-check-skipped`. Click depth shares the condition so the two cannot
  drift apart.

  Re-running that store with the pages it was missing: **70 errors became 0,
  122 orphans became 5**, and 70 pages stopped being counted as not indexable.

### Added
- **`rate-limit-slowed`** — said once at the end of a run that was throttled,
  with how many times the server asked and what the concurrency came down to.
  Not a finding about the site: it is the only thing that lets an eight-minute
  run read as "slower than usual" rather than "something is wrong".

## [1.14.0] — 2026-08-23

### Added
- **`canonical-paginated`** — page 2 of an archive handing its indexing to page
  1, or to any other page of the same sequence. Google's guidance is one
  sentence long: "Don't use the first page of a paginated sequence as the
  canonical page." Page 2 is not the same content as page 1, so it is a request
  Google is under no obligation to honour and may ignore; where it is honoured,
  the whole archive after the first page leaves the index and takes with it the
  only route to every article old enough to have fallen off page 1. It is the
  click-depth story one floor up, and it arrives switched on rather than being
  chosen.

  Four of the six real archives checked while building this ship it:
  css-tricks.com, wordpress.org/news, smashingmagazine.com and
  blog.mozilla.org. The two that name themselves — elementor.com and
  sitepoint.com — are silent, which is the half that matters.

  Only two URL shapes are read, `/page/2/` and `?page=2`, because they are the
  two that can be recognised without guessing. A bare trailing number like
  `/blog/2/` is as often a year or an id, `?p=2` is a WordPress *post* id and
  not a page of anything, and `?start=`/`?offset=` have no first page to work
  back to. A shape that has to be guessed at is not read at all.

  **The check had to be put where these pages actually turn up.** A sitemap
  does not list them: 0 of 9,273 sitemap URLs across css-tricks.com,
  wordpress.org and smashingmagazine.com were paginated, so a crawl of the
  sitemap never meets page 2 and the check would have been correct and dormant.
  The internal-link sweep already fetches every link target to see whether it
  works, and was discarding the HTML — so the same response now answers a third
  question, at the cost of no extra request. Verified against the live site:
  smashingmagazine.com/articles/ links to pages 2 and 3, and both are reported,
  in the 106 requests the sweep was making anyway.

## [1.13.0] — 2026-08-21

### Added
- **`link-no-text` and `anchor-generic`** — the words attached to a link, which
  `parse.mjs` has been discarding since the first commit. They are the one
  description of a page that does not come from the page itself, which is why
  they were the last thing on the list a `fetch` loop could honestly read.

  A link's name is resolved the way a browser resolves an accessible name — the
  text inside, then an image's `alt`, then `aria-label`, then the anchor's own
  `title`, then an `<svg><title>` — because each of those is a real way to label
  a link and calling any of them unlabelled would be wrong. `aria-labelledby` is
  believed rather than followed. A framework binding (`:alt`, `[ariaLabel]`,
  `[attr.aria-label]`) counts as a label the author supplied: that is the trap
  that once made `img-alt` report twenty-four of allbirds.com's images as
  missing alt.

  **`link-no-text`** is a destination that *nothing* names. Three real sites
  taught this its final shape, each by producing a false positive first:

  - css-tricks.com's homepage has 33 links with no text at all. Every one is a
    heading-anchor icon pointing at a `#fragment`, `aria-hidden`, decorative.
    Fragment links were already excluded, so the check was right by
    construction — but it is worth knowing that this is what the pattern
    usually is.
  - elementor.com's blog index has 23 thumbnails with an emptied `alt` beside
    the headline that names the same article. Reporting those would be a true
    observation with a false conclusion attached, so a destination is only
    unreadable when *no* link anywhere names it.
  - wordpress.org/education names Campus Connect three times at
    `/campus-connect/` and once, wordlessly, at `/campus-connect`. Matching
    href strings called a page with three good links unreadable; destinations
    are now keyed without the trailing slash.

  What survives all three is genuine: elementor.com/trust links five ISO and
  SOC certificate PDFs through badge images with no `alt`, so Google is handed
  five documents it can index and nothing about any of them, and a screen
  reader reads out the filename. Grouped by destination rather than per page,
  because these live in headers and footers and the same icon on two hundred
  pages is one thing to fix.

  **`anchor-generic`** is a page whose inbound links *all* say "read more".
  Reporting each such link would fire on every blog index ever built — a card
  under a headline has to say something. The finding is the page that has
  nothing else: no link anywhere on the site tells Google what it is about.
  `info`, and the word list is deliberately short and unarguable. "Get started"
  and "Book now" are not on it; they say something about the destination.

  Silent across fitculturepilates.com, jekyllrb.com, css-tricks.com,
  smashingmagazine.com, wordpress.org, w3.org, gnu.org and freecodecamp.org —
  some 12,000 internal anchors.

### Changed
- **The HTML report can carry a way back.** `html()` takes an optional
  `{ backHref, backLabel }` and renders a link in the bar when given one. Only
  the hosted front end passes it: the report replaces the page it streamed
  into, and without this the only route back to the form was the browser's back
  button onto a stale log. A report written to a file has nowhere to go back
  to, and still renders without it.

## [1.12.0] — 2026-08-21

### Added
- **An optional hosted front end for Cloudflare Workers** — `worker/index.mjs`,
  `wrangler.jsonc`, and a deploy button, for the case where the person who
  needs an audit will not open a terminal. It imports `audit` and `html` the
  same way `bin/seo-audit.mjs` does and re-implements no check: the same crawl,
  the same findings, the same self-contained report.

  **The CLI is unchanged and is still the way to run this.** It is free, it has
  no ceiling, and it runs two checks the hosted version cannot. Nothing was
  added to `package.json`: Cloudflare's build runs `npx wrangler deploy` on
  their side, so the repository still installs nothing and `npm test` still
  needs nothing. The Worker holds to `fetch`, `Request`, `Response` and
  `TransformStream`, which Node 22 has too — so its 14 tests run under
  `node --test` like everything else.

  What the honesty rules cost here, and what they bought:

  - **It refuses to audit anything until `AUDIT_TOKEN` is set**, and says so on
    every page. Deploying is one click and setting a secret is a separate step;
    between the two, an open crawler on someone's account is not an acceptable
    default. `ALLOWED_HOSTS` narrows it further, to the hosts you name.
  - **Certificate expiry cannot be checked there** — `node:tls` is only
    partially supported by the runtime and reading a peer certificate is one of
    the missing parts. Rather than let it fail quietly, every hosted report
    carries a note saying so. A missing finding reads exactly like a passing
    one, and a report two checks shorter than the CLI's, with nothing to say
    it, is worse than no report.
  - **It cannot run on Cloudflare's free plan**, and `docs/hosting.md` says
    that first rather than in a footnote. 10ms of CPU and 50 outbound fetches
    per invocation is about sixteen pages — which is precisely the failure this
    tool exists to point at. The Paid plan is $5/month, and past that the
    marginal cost is about a hundredth of a cent per audit, because Cloudflare
    does not bill for the fetches a Worker makes.

  Progress is streamed as server-sent events while the crawl runs, because an
  audit takes a minute or two and a blank tab for that long reads as a hang.

  Verified in the real runtime, not only in theory: `wrangler dev` running
  `workerd` locally audited a real 12-page site end to end and returned a 44KB
  report, with the gate refusing an unauthenticated request, a host outside
  `ALLOWED_HOSTS`, and an unconfigured deployment. The bundle builds at 34KB
  gzipped.

- **`docs/hosting.md`** — what it costs, why the free plan cannot run it, what
  it is not allowed to reach, the two checks it cannot do, and how to turn it
  off. Including the part that is easy to leave out: deleting the Worker does
  not cancel the $5/month plan, and the charge is on your account under your
  agreement with Cloudflare, at your own risk.

### Changed
- **The logo is centred in its own box and survives a dark README.** It sat in
  a 640-wide canvas with its artwork ending at 393, so 37% of the image was
  empty space on the right and the mark drifted left of centre no matter what
  the surrounding markup said. The viewBox is now cropped to the artwork with
  even margins, measured from a render rather than guessed — an attempt to pin
  the width with `textLength` was abandoned when it turned out to break on a
  `<text>` containing a `<tspan>`, spraying the wordmark across the canvas.

  The wordmark was also `#111827` on a transparent background, which is close
  to invisible on GitHub's dark theme. There is now a `docs/logo-dark.svg` and
  the README picks between them with `<picture>`, the pattern GitHub documents.

- **The README carries the official Deploy to Cloudflare button**, centred,
  directly under the sentence saying what the plan costs — with the price and a
  link to `docs/hosting.md` immediately beneath it, because the first thing
  anyone meets should be the bill rather than the button. The badge in the
  header row points at that page too, not at the deploy flow.

## [1.11.0] — 2026-08-21

### Added
- **`deep-page`, `no-path-from-home`, `click-depth-skipped`** — how many links
  from the homepage each page actually is, measured over the link graph the
  crawl already built. No extra requests, except one for the homepage when the
  sitemap does not list it.

  `orphan-page` was reporting the extreme of this shape — nothing links here at
  all — and nothing was reporting the milder version, which is far more common:
  a page five clicks down is found late, crawled rarely, and passed almost
  nothing, while reading as perfect to every grader that opens one URL. The
  shortest route in is printed with the finding, because "five clicks" is a
  complaint and `/ → /docs → /docs/deployment → /docs/deployment/automated →
  /docs/continuous-integration/travis-ci` is a thing to go and fix. Default
  threshold is four clicks, configurable as `limits.maxClickDepth`.

  `no-path-from-home` is the page that is linked, but only from a page that is
  itself unreachable — it hangs off an orphan. Nothing reached it by following
  links from the homepage, so a crawler that has not been handed the sitemap
  never arrives. Orphans themselves are excluded: that is already a finding,
  and one page is not two problems.

  Level is `info` for depth, because depth is sometimes deliberate — an archive
  page four levels down is doing its job.

  **The measurement is declined rather than guessed at in two cases**, both
  reported as `click-depth-skipped` with the reason:

  - The crawl was truncated by `--limit`. Two hundred URLs of thirty thousand
    is a fragment of the graph, and a distance measured across a fragment is
    not the distance.
  - More than 30% of crawled pages have no path from the homepage. That is
    what a JavaScript-built navigation looks like to something that reads
    HTML — and Google renders, so it follows those links fine. eslint.org is
    the case that produced this guard: 464 of its 499 pages look unreachable
    from static HTML, and without it this would have invented 464 findings
    about a site whose navigation works.

  Verified against jekyllrb.com, where every hop of a reported route was
  confirmed by hand in the live HTML and no shorter route existed.

- **`canonical-noindex`** — a canonical pointing at a page that asks not to be
  indexed. The canonical sweep already fetched and parsed the target to check
  it was not a redirect, a 404, or the start of a chain; it never read what the
  target says about indexing.

  A canonical is a request to index B in place of A. If B is `noindex`, both
  pages leave: B because it asked to, and A because it named B as the version
  to keep. Nothing on A shows this. Its own markup is correct, its own robots
  meta says `index`, and the instruction that removes it lives on a different
  page — or in an `X-Robots-Tag` header on that page, which no view-source
  reveals. Both sources are read, exactly as they are for the page's own
  `noindex` and `x-robots-noindex`.

  Reported once per target, matching `canonical-dead` and `canonical-redirects`
  — a paginated archive canonicalling forty pages at one dead parent is one
  problem, not forty. A target that is both `noindex` and canonicalled onward
  reports the `noindex`, since the chain is the smaller half of that.

  Silent across smashingmagazine.com's four real cross-page canonicals, all of
  which point at indexable targets.

- **`viewport-locked`** — `user-scalable=no`, or a `maximum-scale` under 2, in
  a viewport that was previously only checked for existing. Text cannot then
  reach the 200% WCAG 1.4.4 asks for. Safari has ignored the setting since iOS
  10, which is why it survives: it looks fine on the iPhone of whoever tested
  it, and blocks zoom everywhere else. lufthansa.com ships it today, with
  `content` written before `name` — the reversed attribute order the parser
  had to handle to see it at all.

- **`viewport-fixed-width`** — `width=1024` where `width=device-width` belongs.
  A pixel width is a desktop layout announced to a phone: the browser lays the
  page out that wide and scales the result down, and Google indexes what its
  mobile crawler rendered. Only an explicit number fires it; a viewport with no
  `width` key at all — `initial-scale=1,user-scalable=yes`, which is what
  wikipedia.org serves — is a different question and stays silent.

## [1.10.1] — 2026-08-17

### Fixed
- **The `www.` host variant is only tried for a host that can have one.** It was
  built by string concatenation from whatever host was being audited, so
  auditing `http://127.0.0.1:8080` asked a resolver for `www.127.0.0.1` — a
  question with no sensible answer, which a resolver may decline instantly or
  sit on for as long as it likes.

  That made the test suite stall unpredictably, since every fixture test runs
  against `127.0.0.1`. It also affected anyone auditing a local build on
  `localhost`, where the same two requests were pure waste.

  IP addresses and single-label hostnames are now skipped; a registrable domain
  is checked exactly as before. Verified by intercepting `dns.lookup` during a
  fixture run — zero hostname resolutions, everything a literal IP — and by
  confirming a real domain still reports its `www.` redirect chain.

## [1.10.0] — 2026-08-17

### Added
- **`schema-incomplete`** — a type Google can render that is missing a property
  it requires. The markup is valid, the type is right, nothing reports an error,
  and the rich result simply never appears: an `Article` with no `headline`, a
  `BreadcrumbList` with no `itemListElement`, a `Product` with nothing to show.

  The list is deliberately short and covers only fields that have been stable
  for years. Google's requirements move, and a list that goes stale invents
  findings on correct markup — the one failure this tool cannot afford. A type
  it has no opinion about stays silent rather than being guessed at.

  Nodes that are references rather than definitions are skipped: `"publisher":
  { "@type": "Organization", "@id": "…#org" }` points at a full definition made
  elsewhere in the `@graph`, and reading it as a nameless Organization would
  have fired on every site that uses `@id` references.

- **`schema-image-broken`** — an image named in structured data that does not
  load. Google is told to use it for a rich result and finds nothing there,
  usually because a media library was tidied years after the JSON-LD was
  written. Same conservative rule as the other sweeps: 404, 410 or no answer.

- **`uncompressed`** — HTML served with no `content-encoding`. Not an estimate,
  which is the line this tool does not cross: it is a header, read off the
  response. Only for documents past 5KB, because a CDN skipping compression on
  a 900-byte response is doing the right thing.

- **`huge-html`** (note) — a document past 1MB before any images or scripts.
  Google reads far more than that, so this is a signal rather than a limit, and
  set high enough that a page has to be genuinely extraordinary to trip it.

## [1.9.0] — 2026-08-17

### Added
Five checks, all reading facts already on the page or in the response rather
than making a judgement about any of them.

- **`sitemap-not-indexable`** — a URL the sitemap advertises that then asks not
  to be indexed, by `noindex` or by canonicalising elsewhere. The same shape as
  robots.txt disallowing a sitemap URL: each file is defensible alone, and they
  only contradict each other when read together. Nearly free, because 1.7.0
  already worked out which pages are indexable.

  It found a circular one on smashingmagazine.com on the first run: the sitemap
  lists `/category/ai/`, which canonicals to `/categories/ai/`, which 301s back
  to `/category/ai/`. The canonical sends Google somewhere that returns it to
  where it started.

- **`robots-conflict`** — the robots meta tag and `X-Robots-Tag` disagreeing on
  index or follow. Both were already parsed and nothing compared them. Google
  resolves it by taking the most restrictive, so the page does what neither file
  says on its own, and whichever one you are reading tells you the wrong story.

- **`canonical-chain`** — a canonical pointing at a page that canonicals
  somewhere else again. The target loading was already checked; whether it
  claims itself was not.

- **`meta-refresh`** — `<meta http-equiv="refresh" content="0;url=…">`. A
  redirect that nothing treats as one, passing signals poorly, and showing a
  visitor a page you did not mean them to read when there is a delay.

- **`sitemap-too-many-urls` and `sitemap-too-large`** — the protocol's 50,000
  URLs and 50MB, counted **per file** rather than per site, since that is how
  the limits are written. A site with four 20,000-URL sitemaps is entirely legal
  and stays silent.

## [1.8.0] — 2026-08-15

### Added
- **Two checks on the image `title` attribute** — `img-title-duplicates-alt`
  and `img-title-on-decorative`, both notes.

  Deliberately *not* a "missing title" check, which is what tools normally ship
  here. A `title` is a hover tooltip: invisible on touch, unread by Google, and
  W3C guidance discourages putting anything that matters in it. An image without
  one has nothing wrong with it, so that check would fire on nearly every image
  on nearly every site.

  What is worth reporting is when `title` contradicts something on the same tag.
  Repeating `alt` verbatim adds nothing for a sighted visitor and is read twice
  by a screen reader that surfaces both — usually one CMS field populating both
  attributes. And a `title` on an image declared decorative by `alt=""` or
  `role="presentation"` is markup saying "ignore this" while attaching a tooltip
  to it; one of the two statements is wrong.

  Verified against wpbeginner.com, which carries a `title` on 26 of its 117
  images: 14 identical to the `alt`, 6 on decorative images.

## [1.7.0] — 2026-08-15

### Added
- **`nofollow`.** `noindex` was checked and its counterpart never was.
  `nofollow-page` covers the meta tag and the header, and names the combination
  when both are set — a page that is neither indexed nor followed is a full stop
  for a crawler. `internal-nofollow` (note) reports internal links the page tells
  Google not to follow.

  Fragments are stripped and self-links dropped from that second check, because
  WordPress marks every comment-reply link `rel="nofollow"` pointing at
  `#respond` on the page it is already on — which withholds no path anywhere and
  would have fired on every article of every WordPress site. Found on the first
  real run.

- **Findings are grouped by area**, not only by severity: Indexability, Content,
  Links, Redirects, Images, Social, Structured data, Multilingual, Sitemap &
  robots, Site & security, Performance. Severity says how loudly to complain;
  the area says who fixes it. In the terminal, the Markdown and the HTML.

  A test walks `src/` for every check id and fails if any lacks a category, so
  this cannot quietly rot. It caught `viewport-missing` the first time it ran.

- **Pages that will not be indexed are marked.** A finding on a page carrying
  `noindex`, or whose canonical points elsewhere, is tagged `not indexable` in
  all three formats, and the count appears in the HTML header. The same thin
  page is a problem when Google will index it and noise when it will not, and
  that distinction is often more useful than the severity.

- **`--check-external`** sweeps outbound links, off by default. Only a 404, a
  410 or no answer at all counts as broken: these are other people's servers,
  they rate-limit and bot-block, and a 403 from someone else's WAF is the most
  productive false positive this tool could invent. An outbound link that merely
  redirects is a note. `maxExternalChecks` bounds it at 100, because one machine
  hammering a hundred third parties is rude at scale.

  Both new flags are exposed on the Action too.

## [1.6.0] — 2026-08-15

### Added
- **`--verbose` prints each request as it happens.** A run was silent from the
  first line to the last: on a 53-page site, `crawling …` and then twenty
  seconds of nothing before the whole report arrived at once. A slow site looked
  exactly like a hung one, and there was no way to tell which page it was
  sitting on.

  Covers every stage that takes time — sitemap discovery, the page crawl, the
  link and image sweeps, hreflang alternates, redirect-map rules, and PageSpeed
  Insights, which announces each measurement *before* making it because each one
  costs about twelve seconds.

  Plain lines rather than a spinner or a redrawing counter, deliberately: a long
  run is exactly the one whose output gets piped to a file or read back out of a
  CI log, and neither can show a cursor trick. A timeout arrives as status `0`,
  so a stall stays on screen rather than being overwritten.

  Written to **stderr**, so `--json` and `--md` are untouched. `--quiet` wins
  over `--verbose` — asking for silence and getting a running commentary would
  be the more surprising of the two.

## [1.5.5] — 2026-08-14

### Changed
- **The HTML report was redesigned.** It read as a default stylesheet rather
  than something you would put in front of a client. Now: a masthead carrying
  the run date, the origin as the headline, and a facts line giving pages,
  requests, elapsed time and how many findings the config silenced — which the
  old header did not say at all.

  Findings became bordered cards with a severity pill, a monospace check id and
  the affected URLs in monospace, since a URL is an identifier rather than
  prose. Numbers are tabular throughout, so counts line up in a column. The
  palette is one tone per severity, used on the pill and the tally and nowhere
  else; light mode semantics were darkened to hold against white, and dark mode
  is true black. No shadows and no gradients — flat surfaces and hairline rules
  are what make a report read as a tool.

  Zero findings now renders a proper panel — *every check passed on all N
  pages* — rather than a sentence of body text. A clean audit is the result you
  most want to hand somebody.

  Still one self-contained file with **no external assets**: no stylesheet link,
  no script, no webfont, no remote image. A report that needs the network
  renders blank in an email client, on a plane, or in three years when the CDN
  has moved on. That is also why the masthead is a text wordmark and not a logo.

  `docs/report.jpg` in the README was regenerated to match, since it advertised
  a design the tool no longer produced.

## [1.5.4] — 2026-08-14

### Fixed
- **Pages in Japanese, Chinese or Thai were reported as thin.** Those scripts do
  not put spaces between words, so splitting on whitespace counted an entire
  paragraph as one. The Japanese translation of a React docs page counted 177
  words against the English original's 411 — the same page, the same content —
  and was called thin while the English one passed.

  Characters in unspaced scripts are now counted at roughly two to the word,
  the usual working equivalence. That is an approximation and a deliberately
  generous one: over-counting keeps a real page quiet, under-counting calls it
  thin, and only one of those is a finding somebody has to argue with. Latin and
  Arabic counts are unchanged — Arabic spaces its words, and its pages were
  never affected.

  Found by a fourth sweep, against docusaurus.io, ja.react.dev, aljazeera.net,
  vuejs.org and jestjs.io. Notably the only bug that sweep found: the previous
  three rounds of parser fixes held on documentation generators, on right-to-left
  markup, and on non-Latin scripts.

## [1.5.3] — 2026-08-14

### Fixed
A third sweep, against the shapes the first two missed: WordPress, e-commerce
and a JavaScript-framework front end — techcrunch.com, allbirds.com,
wpbeginner.com, linear.app and gymshark.com. 54 errors reported; 35 were the
tool's fault.

- **Framework bindings were read as the attributes they bind.** `attr()`'s
  lookbehind excluded `-` (so `data-src` was safe) but not `:` or `[`, so
  Alpine's `:src`, Vue's `v-bind:src` and Angular's `[src]` were all read as a
  real `src`. allbirds.com binds
  `:src="(cardRefs['7205190238288']?.selectedImage…)"`, and twenty-four of its
  images were reported as 404s for URLs that were never URLs. The same binding
  on `:href` produced broken links pointing at JavaScript template literals.

- **An `alt` supplied by a binding is an `alt` the author supplied.** With the
  above fixed, `:alt="item.title"` became invisible and the images started
  reporting as having no alt at all. The value cannot be read without running
  the framework, but the intent is plain, and guessing wrong at error level is
  the failure this tool exists to avoid. allbirds.com has 43 images: 40 with a
  literal alt, 3 bound, and none with neither.

- **`og:image` judged the first hop.** An og:image on `http://` that 301s to
  https loads perfectly well — every scraper follows it — and seven of
  allbirds.com's were reported as previewing blank. The chain is now followed
  and only the final answer judged, conservatively: 404, 410 or a dead
  connection, so hotlink protection is not mistaken for a missing file.

That is the third time reading only the first hop has been wrong, after soft
404s and the link-crawl seed.

### Upgrading
Take this one if you audit anything built with Alpine, Vue or Angular. 1.5.2
read `:src` and `:href` as real attributes, so a page using bindings could
report dozens of broken images and links that do not exist. This release only
removes findings.

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
