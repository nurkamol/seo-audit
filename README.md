<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo.svg" alt="seo-audit — every page, not just the homepage" width="440">
  </picture>
</p>

<p align="center">
  <b>Crawl a site's sitemap and check every page</b> for the SEO, metadata and
  structured-data problems that single-page graders miss.<br>
  Zero dependencies · one command · works in CI.
</p>

<p align="center">
  <a href="https://github.com/marketplace/actions/full-site-seo-audit"><img src="https://img.shields.io/badge/GitHub%20Marketplace-Full--site%20SEO%20Audit-f97316?logo=github&logoColor=white" alt="GitHub Marketplace"></a>
  <a href="https://github.com/nurkamol/seo-audit/actions/workflows/test.yml"><img src="https://github.com/nurkamol/seo-audit/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <a href="https://github.com/nurkamol/seo-audit/releases"><img src="https://img.shields.io/github/v/release/nurkamol/seo-audit?color=f97316" alt="release"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-3c873a" alt="node >= 18">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="zero dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
  <a href="docs/hosting.md"><img src="https://img.shields.io/badge/Cloudflare%20Workers-optional%2C%20paid-f38020?logo=cloudflare&logoColor=white" alt="Optional hosted version on Cloudflare Workers"></a>
</p>

```yaml
# In a workflow — https://github.com/marketplace/actions/full-site-seo-audit
- uses: nurkamol/seo-audit@v1
  with:
    url: https://example.com
```

```bash
# Or anywhere, with nothing installed
npx github:nurkamol/seo-audit@v1 https://example.com
```

<p align="center"><img src="docs/terminal.svg" alt="Example output" width="820"></p>

---

## Why

Free SEO graders audit **one URL**, almost always the homepage. They will tell
you your title tag is 48 characters and your homepage loads in 0.38 seconds,
and happily award a B+ to a site where page 23 has a duplicate description,
page 31 is 112 words long, and the language switcher links to a 404.

That last one is real. This tool's first run against a production site found
the EN/RU switcher on every translated article pointing at a page that did not
exist. Three commercial graders had audited the same site that morning; none
could see it, because the link is only broken on pages they never opened.

**What it owns:** technical correctness, on every page, every deploy.
**What it will not pretend to own:** rankings. Those are decided by backlinks,
a Business Profile and content people want — none of which a crawler can fix.
It also refuses to *estimate* performance; with `--psi` it asks Google for the
real measurement instead.

|  | seo-audit | Typical free grader |
|---|---|---|
| Pages checked | Every URL in the sitemap | One |
| Cross-page checks | Duplicates, hreflang pairs, orphans | — |
| Broken links | Whole-site sweep | — |
| Regression guard | Baseline diff, fails CI on new findings only | — |
| Performance | Google's own numbers via `--psi` | Estimated, or Lighthouse on one page |
| Output | Terminal · Markdown · HTML · JSON | A web page and a PDF upsell |
| Cost | Free, no account | Free tier, then a subscription |

<p align="center"><img src="docs/report.jpg" alt="The HTML report" width="820"></p>

---

## The playbook

The tool verifies about two thirds of what a site needs. The rest is judgement,
content and off-site work, and it is written down:

### 📋 [docs/SEO-PLAYBOOK.md](docs/SEO-PLAYBOOK.md)

A checklist for taking a site from "probably fine" to genuinely clean —
crawlability, internal linking, multilingual, images, social previews,
structured data, performance, credibility and local search. Ordered by impact
and written from what was actually broken on real projects, including the traps
that only show up once you have hit them.

```bash
# In a new project
curl -o docs/SEO-PLAYBOOK.md \
  https://raw.githubusercontent.com/nurkamol/seo-audit/main/docs/SEO-PLAYBOOK.md
curl -o seo-audit.config.json \
  https://raw.githubusercontent.com/nurkamol/seo-audit/main/docs/seo-audit.config.example.json

npx github:nurkamol/seo-audit@v1 https://example.com --html audit.html
```

Then work down the checklist. It ends with a prompt for handing the whole
thing to an AI agent, including the two instructions that keep an enthusiastic
pass from doing damage: don't invent business facts, and don't declare success
against a stale cache.

---

## Usage

```bash
# Crawl and print to the terminal
npx github:nurkamol/seo-audit https://example.com

# Save a Markdown report you can commit, diff, or send to a client
npx github:nurkamol/seo-audit https://example.com --md audit.md

# Audit a local build before it ships
npm run preview &
npx github:nurkamol/seo-audit http://localhost:4321 --limit 50

# A whole portfolio, one table
npx github:nurkamol/seo-audit one.example two.example three.example
```

### How the report is organised

Findings are grouped by **area**, not just by severity — Indexability, Content,
Links, Redirects, Images, Social, Structured data, Multilingual, Sitemap &
robots, Site & security, Performance. Severity says how loudly to complain; the
area says who fixes it. Thirty findings sorted only by severity is a list you
read once; the same thirty under *Images* and *Multilingual* is a list you can
hand to two people.

Findings on a page that **won't be indexed** — it carries `noindex`, or its
canonical points somewhere else — are marked `not indexable`. The same thin
page is a problem when Google will index it and noise when it won't, and that
distinction is often more useful than the severity.

### Checking outbound links

Off by default, and that's a judgement rather than an omission:

```bash
npx github:nurkamol/seo-audit https://example.com --check-external
```

These are other people's servers. They rate-limit, they bot-block, and plenty
answer `403` to anything without a browser's fingerprint — so only a **404, a
410, or no answer at all** is ever reported as broken. An outbound link that
merely redirects is a note, not a problem. `maxExternalChecks` bounds the sweep
(default 100), because one machine hammering a hundred third parties is rude at
scale.

### Watching a run

A crawl of any size is otherwise silent from the first line to the last, which
makes a slow site look exactly like a hung one. `--verbose` prints each request
as it happens:

```
  sitemap    /sitemap-index.xml  42 URLs
  crawl      200    128ms  /
  crawl      200    180ms  /faq/
  crawl      200    343ms  /about/
  crawl      42 pages in 6.8s
  links      87 distinct targets to check
  links      404     92ms  /old-page/
  images     26 distinct images to check
  psi        measuring 1 of 3 (~12s)  /
```

Plain lines rather than a spinner, deliberately: a long run is exactly the one
whose output gets piped to a file or read back out of a CI log, and neither can
show a cursor trick. It also means the page a crawl is stuck on stays on screen
instead of being overwritten — a timeout arrives as status `0`, so a stall is
visible rather than blank.

Everything goes to **stderr**, so `--json` and `--md` are unaffected and
`… --verbose --json report.json` still writes clean JSON. `--quiet` wins over
`--verbose`: asking for silence and getting a running commentary would be the
more surprising of the two.

### Checking a migration's redirects

A redirect map is written once, verified once, and then rots quietly: a later
change to a destination turns an entry into a hop through a 404, and nothing
tells anyone. The old URLs are the ones carrying the links and the rankings, so
this is one of the few SEO failures that is both expensive and completely
silent.

```bash
npx github:nurkamol/seo-audit https://example.com --redirects _redirects
```

The file is the Netlify `_redirects` shape, which is also what most people
write by hand — `#` comments, and `to` and the status both optional:

```
/old-path        /new-path      301
/also-old        /new-path
/just-an-old-url
```

Every old URL is asked for, and what actually happens is reported:

| | |
|---|---|
| `redirect-dead` | error — the old URL 404s. The rule never shipped |
| `redirect-broken` | error — it redirects, and lands on nothing. Worse than no rule, because it looks handled |
| `redirect-not-applied` | warning — the old URL still answers 200 |
| `redirect-hops` | warning — more than one hop to arrive |
| `redirect-elsewhere` | warning — lands somewhere the map does not expect |
| `redirect-temporary` | warning — served as 302 where the map says 301 |

Rules with a `*` or a `:placeholder` match a shape rather than a URL, so asking
for them literally proves nothing. They are counted and reported, never guessed
at. A rule that works in one hop reports nothing at all.

### Sites without a sitemap

If no sitemap can be found, the crawl follows links from the homepage instead
of stopping — the sites least likely to have been looked after were the ones
this used to refuse to look at. `no-sitemap` is still reported, as a warning
rather than an error, because the pages get audited either way.

The link crawl obeys `robots.txt`, follows a redirecting homepage (plenty of
sites send `/` to a locale), skips assets, and treats two URLs redirecting to
one page as one page. `missing-from-sitemap` stays quiet, since every page
found this way is by definition absent from a sitemap that does not exist.

### A portfolio

Name more than one site and the report becomes a table, worst site first —
which is the question a per-site report can never answer, because each one
only ever sees itself.

```
  Portfolio — 3 sites · 24 pages · 36.3s

  SITE                   PAGES     ✗     !     ·
  fitculturepilates.com      8     2    28    20
  vitejs.dev                 8     2    19    32
  astro.build                8     1    31    26

  5 errors across 3 of 3 sites  ·  78 warnings  ·  78 notes
```

`--md` and `--html` write one file with the table on top and each site's full
report underneath, so a single section can be lifted out and sent to whoever
owns that site. `--json` writes one object with a `sites` array. The run exits
1 if **any** site fails, because a portfolio check that passes while a site in
it is broken is a check nobody can trust.

Sites run one at a time: interleaved progress from twenty hosts is unreadable,
and each audit is already parallel inside itself.

`--baseline`, `--against` and `--update-baseline` compare a site against
itself, so they refuse to run across a portfolio rather than half-answering the
question. Run those per site. The GitHub Action is single-site for the same
reason.

### Options

| Option | Default | |
|---|---|---|
| `--md <file>` | — | Write a Markdown report |
| `--html <file>` | — | Write a self-contained HTML report — one file, no assets |
| `--json <file>` | — | Write a JSON report — also usable as a baseline |
| `--baseline <file>` | — | Compare against a previous `--json` run; show only what changed |
| `--update-baseline` | — | Rewrite the baseline after comparing |
| `--limit <n>` | 200 | Maximum pages to check |
| `--concurrency <n>` | 6 | Parallel requests. Comes down on its own if the server answers `429` |
| `--sitemap <url>` | auto | If `robots.txt` doesn't declare one and it isn't at a usual path. Without any sitemap, the crawl follows links instead |
| `--redirects <file>` | — | Check a migration's redirect map against the live site (see below) |
| `--check-external` | — | Also check links pointing off the site (see below) |
| `--user-agent <ua>` | `seo-audit …` | Identify as something else |
| `--config <file>` | `seo-audit.config.json` | Per-site configuration |
| `--ignore <ids>` | — | Comma-separated check ids to silence for this run |
| `--psi <urls>` | — | Measure these pages with PageSpeed Insights. A path glob names a section (see below) |
| `--psi-sample <n>` | 3 | Pages measured per section glob |
| `--psi-strategy` | `mobile` | `mobile` or `desktop` |
| `--against <url>` | — | Compare against another deployment now — preview vs production |
| `--settle <s>` | — | Wait until the site serves consistent HTML before crawling |
| `--fail-on <level>` | `error` | Exit 1 at `error`, `warn`, `new`, or `never` |
| `--version` | — | Print the version |
| `--quiet` | — | Print nothing; use the exit code and the files |
| `--verbose` | — | Print each request as it happens, to stderr (see below) |

---

## Configuration

Every site has findings that are true and deliberate. A contact page is *meant*
to be short; a privacy policy has no business carrying editorial links. Left
unsaid, those fill the report with noise nobody reads, and the one new finding
that matters gets lost.

Drop a `seo-audit.config.json` next to where you run it:

```json
{
  "limit": 200,
  "failOn": "error",
  "limits": { "thinWords": 250 },
  "sites": [
    "https://one.example",
    { "url": "https://two.example", "limit": 50, "ignore": ["thin-content"] }
  ],
  "maxLinkChecks": 200,
  "maxImageChecks": 200,
  "psi": ["/", "/pricing/", "/journal/**"],
  "ignore": [
    "img-srcset",
    { "id": "thin-content", "urls": ["/contact/", "/thanks/", "**/legal/**"] },
    { "id": "no-editorial-links", "urls": ["**/privacy-policy/", "**/terms-of-use/"] }
  ],
  "expect": [
    { "urls": ["/journal/*/"], "types": ["BlogPosting"] },
    { "urls": ["/"], "types": ["LocalBusiness", "WebSite"] },
    { "urls": ["/faq/"], "types": ["FAQPage"] }
  ]
}
```

- **`sites`** — a portfolio. Each entry is a URL, or an object with a `url` and
  whatever that site overrides — a portfolio is not a list of interchangeable
  sites, and one of them has a deliberately short contact page. Overrides land
  on top of the shared config; `ignore` accumulates rather than replacing,
  since a portfolio-wide rule and a site rule are both meant to apply. URLs
  given on the command line replace this list entirely, which is how you audit
  a subset.
- **`limits`** — thresholds this site disagrees with: `titleMin`, `titleMax`,
  `descMin`, `descMax`, `thinWords`, `slowMs`, `maxClickDepth`.
- **`maxLinkChecks`** — how many distinct link targets the site-wide sweep
  fetches, default 200. The sweep checks every internal link on every crawled
  page, so a large site can present thousands of targets; this bounds the run.
  When it bites, the report says how many were left unchecked rather than
  quietly describing a fraction of the site.
- **`maxImageChecks`** — the same bound for the image sweep, default 200,
  counted in distinct **files** rather than URLs. An image CDN serves one file
  at every size asked for, so `photo.avif?width=150` and `?width=750` are one
  image and one request; `width`, `height`, `w`, `h` and `dpr` are dropped
  before counting, and `v` is not, because a different version is a different
  asset. On a real store this was 488 files behind 767 URLs. The report names
  the number to set if the cap was reached.

- **`maxExternalChecks`** — how many outbound links `--check-external` fetches,
  default 100. Third-party hosts are somebody else's to hammer.
- **`redirects`** — path to a redirect map, the same as `--redirects`.
  **`maxRedirectChecks`** bounds how many of its rules are tested, default 200.
- **`psi`** — pages to measure with PageSpeed Insights, as paths. A path glob
  names a section: `/journal/**` measures a sample of the crawled pages under
  it, three by default, spread across the section rather than taken off the
  front. PageSpeed Insights costs about 12 seconds a page, so a section of
  forty measured whole is eight minutes — the report says how many of the
  matched pages were actually measured, because a sample that stayed quiet
  about the rest would read as a clean bill of health for the whole section.
  Raise it with `--psi-sample`, and expect the wait. The sample is the same on
  every run, so a `--baseline` comparison stays meaningful.
- **`ignore`** — a bare check id silences it everywhere; `{ id, urls }` silences
  it only where it is intended. `*` stops at a slash, `**` does not. The id is
  printed with every finding.
- **`expect`** — which schema types a group of pages must carry. This is the
  difference between "the JSON-LD parses" and "this article is actually marked
  up as an article", and it is the check that catches a template quietly
  dropping its structured data.

---

## Catching regressions

The useful question after the first run is not "how many warnings" — that
number stops moving. It is "did this deploy break something that worked
yesterday".

```bash
# First run writes the baseline
seo-audit https://example.com --baseline seo-baseline.json

# Later runs report only the difference
seo-audit https://example.com --baseline seo-baseline.json
```

```
  ✓ 3 fixed since 2026-08-08
    · Link to a page that does not exist  https://example.com/ru/journal/…

  ✗ 1 new since 2026-08-08
    ✗ Missing expected structured data: BlogPosting
      Page declares WebSite.
      · https://example.com/journal/new-article/

  12 unchanged
```

Commit the baseline. `--fail-on new` then fails a build on a regression while
tolerating the backlog you already know about — which is what makes the check
survivable in CI instead of being switched off in week two.

### In CI

```yaml
- run: |
    npx github:nurkamol/seo-audit https://example.com \
      --baseline seo-baseline.json --fail-on new --md audit.md
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: seo-audit, path: audit.md }
```

---

## Hosting it, for people who will not open a terminal

Optional, and off the main path. Everything above is free and runs on your own
machine; this is a small password-protected web page you deploy to **your own
Cloudflare account**, so a colleague can audit a site by filling in a form. It
runs the same code and produces the same report.

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/nurkamol/seo-audit"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" width="184" height="39"></a>
</p>

<p align="center">
  <sub><b>Needs the $5/month Workers Paid plan.</b> Your account, your bill.<br>
  Read <a href="docs/hosting.md">docs/hosting.md</a> before you click it.</sub>
</p>

The short version:

- **It cannot run on Cloudflare's free plan.** 10ms of CPU and 50 outbound
  fetches per invocation works out at about sixteen pages — which is the exact
  failure this tool exists to point at. It needs the **$5/month Workers Paid**
  plan.
- **After that it is effectively free to run.** Cloudflare does not bill for the
  fetches a Worker makes, so the crawl costs nothing and an audit is about a
  hundredth of a cent of CPU. The $5 is the whole bill for normal use.
- **The charge is recurring and it is yours.** Your account, your card, your
  agreement with Cloudflare. Deleting the Worker does not cancel the plan.
  MIT licence, no warranty, at your own risk.
- **It will not audit anything until you set `AUDIT_TOKEN`.** What you are
  deploying is a crawler with a public address, and an open one gets pointed at
  other people's sites from your account. Set `ALLOWED_HOSTS` too.
- **Two checks do not work there.** `tls-expiring` and `tls-expired` need a TLS
  socket the Workers runtime does not offer. Every hosted report says so, rather
  than quietly coming up two checks short.

If you have a GitHub repository, the Action above is free, unlimited and
better. This is for the case where it genuinely has to be a web page.

---

## What it checks

Findings come at three levels: **error** (wrong, and costing traffic), **warning** (worth fixing, judgement involved), **note** (worth knowing, may be deliberate).

### Per page

| Check | Level |
|---|---|
| Page returns 200 and is not a redirect listed in the sitemap | error |
| A page the server answers `429` to is reported as rate limited, never as a page that failed — the crawl waits, slows down and comes back first | note |
| `noindex` on a page the sitemap advertises | error |
| `X-Robots-Tag: noindex` — the same instruction as a header, invisible in the HTML | error |
| `nofollow` on the page — Google follows none of its links, navigation included | warning |
| The robots meta tag and `X-Robots-Tag` don't contradict each other | warning |
| No `<meta http-equiv="refresh">` — a redirect nothing treats as one | warning |
| Internal links aren't `rel="nofollow"` — a page refusing to pass through its own site | note |
| `<title>` present, 15–60 characters | error / warning |
| Meta description present, 70–160 characters | warning |
| Exactly one `<h1>` | error / warning |
| `lang` attribute and viewport meta | warning / error |
| The viewport doesn't block zooming — `user-scalable=no` or a `maximum-scale` under 2 forbids the 200% WCAG 1.4.4 asks for, and Safari has ignored it since iOS 10 | warning |
| The viewport isn't a fixed pixel width — `width=1024` lays the page out that wide on a phone and scales it down, and that is what Google indexes | warning |
| Canonical present, single, self-referencing | warning / error / note |
| The canonical target isn't `noindex` — a page that hands its indexing to one leaves the index with it | error |
| Page 2 of an archive names itself, not page 1 — Google's guidance is "Don't use the first page of a paginated sequence as the canonical page", and a sitemap almost never lists these pages, so they're read where they're linked | error |
| The canonical target isn't itself canonicalised elsewhere — Google needn't follow a chain | warning |
| `og:title`, `og:description`, `og:image` present | warning |
| `og:image` is an absolute URL — a scraper has no page to resolve a relative one against | error |
| `og:image` is not WebP — LinkedIn won't render it, WhatsApp is unreliable | warning |
| `og:image` declares width and height | note |
| `hreflang` codes are well formed — `en_US` with an underscore is the usual slip | error |
| `hreflang` lists the page itself, not only its translations | warning |
| `<html lang>` agrees with what the page's own `hreflang` calls it | warning |
| `<html lang>` agrees with the `Content-Language` header, compared by primary subtag — a header listing several languages agrees if the page's is one of them | warning |
| JSON-LD parses and carries a `@type` (or a `@graph`) | error / warning |
| Types Google can render carry the properties it requires — an `Article` with no `headline` gets no rich result | warning |
| The dates do not contradict themselves — a page modified before it was published, or dated next Tuesday, is not a freshness signal | warning |
| Images named in structured data actually load | warning |
| Every `<img>` has an `alt` attribute (empty is correct for decorative) | error |
| `alt` isn't a filename — `alt="DSC_0042.jpg"` is what a CMS fills in for you | warning |
| `alt` isn't a placeholder — `alt="image"`, `alt="logo"` name the medium, not the content | warning |
| Three or more images don't share one `alt` | note |
| `alt` is under 125 characters — it's read in one breath, with no way to skim | note |
| `title` doesn't just repeat `alt` — one field filling both adds nothing and can be read twice | note |
| `title` isn't attached to an image declared decorative — the markup contradicts itself | note |
| Every `<img>` has `width` and `height` — otherwise the page reflows | warning |
| Images offer a `srcset` rather than one size for every screen | note |
| No image is both `loading="lazy"` and `fetchpriority="high"` — told to wait and told to hurry, and lazy decides when | note |
| Word count above ~300 — Japanese, Chinese and Thai are counted by character, since they don't space words | warning |
| At least one link inside the content, not just navigation | note |
| No `http://` **subresources** on an HTTPS page — a hyperlink to one is not mixed content | error |
| HTML arrives compressed, once it's big enough to be worth compressing | warning |
| Images declared decorative by `alt=""` **or** `role="presentation"` are left alone | — |

### Across pages

| Check | Level |
|---|---|
| No two pages share a title | warning |
| No two pages share a meta description | warning |
| `hreflang` is reciprocal — Google drops one-way pairs | error |
| Something in the `hreflang` set is an `x-default` | note |
| Pages carry the schema types `expect` says they should | error |
| No page is an orphan — in the sitemap but linked from nowhere | warning |
| Orphans are only looked for when the crawl actually saw the site — a run cut short by `--limit`, or with pages that never loaded, says so instead of calling a fragment full of orphans | note |
| Every page is within four clicks of the homepage, counted over the links actually in the HTML | note |
| Every page has *some* path from the homepage — one that hangs off an unreachable page is only found by handing Google the sitemap | warning |
| Every destination has at least one link that names it — an icon or an `alt=""` thumbnail with no text, no `aria-label` and no `title` tells Google nothing and reads a URL aloud to a screen reader | warning |
| No page is described only by "read more" — the words on a link are the one description of a page that does not come from the page itself | note |
| No phrase describes two different pages — "Collections" pointing at both the reference page and the tutorial chapter makes them compete, and only destinations this crawl fetched are compared | note |

### Whole site

| Check | Level |
|---|---|
| `robots.txt` exists, does not block everything, advertises the sitemap | error / warning / note |
| No sitemap URL is disallowed by `robots.txt` — the site contradicting itself | error |
| Every sitemap URL is actually indexable — not `noindex`, not canonicalised away | warning |
| Each sitemap file is within the protocol's 50,000 URLs and 50MB | error |
| The sitemap declares `lastmod` at all | note |
| `lastmod` differs between pages — one date on every URL is a build stamp, and crawlers learn to ignore it | note |
| No URL is listed twice — across two files of an index, or twice in one. Image and video sitemaps are skipped, since one entry per image is the format working | note |
| No `lastmod` is in the future | warning |
| A favicon Google can use — the home page declares one that loads, or `/favicon.ico` is there | warning / note |
| `llms.txt` exists | note |
| Everything once-per-domain is read on the host that answers — audit `example.com` when the site lives at `www.` and the audit moves there, saying so, rather than reading robots.txt off a 301 | note |
| `http://`, `www.` and `https://www.` each reach the canonical host in one hop | warning |
| The TLS certificate is not expired, and not expiring within 14 days | error / warning |
| HSTS, `X-Content-Type-Options`, `Referrer-Policy`, CSP headers | warning / note |
| A URL that cannot exist returns 404, not a 200 error page — the redirect chain is followed to its end | error / warning |
| There is something to audit at all — no sitemap *and* no crawlable homepage is `nothing-crawlable` | error |
| Every internal link resolves — the site-wide 404 sweep | error |
| Any linked page that turns out to be page 2 of a sequence gets its canonical read, from the response the sweep already fetched | error |
| Outbound links resolve, with `--check-external` — only a 404, 410 or no answer counts | warning / note |
| Every `<img>` actually loads — 403 is hotlink protection, not a broken file, and is not reported | error |
| Every `hreflang` alternate actually loads, including versions outside the crawl | error |
| Internal links point at final URLs rather than redirects | note |
| No page is linked but missing from the sitemap | warning |
| The link and image sweeps say so when they stop at their cap rather than implying they checked everything | note |
| Every `og:image` actually loads, and isn't too heavy to scrape | error / warning |

---

## Reading the output

```
  https://example.com
  31 pages · 71 requests · 12.9s

  ✗ No <h1> ×17
    The page has no headline.
    · https://example.com/schedule/
    · https://example.com/teacher-trainings/
    …

  ✗ Sitemap URL redirects
    301 → https://example.com/summer-offer/. A sitemap should list final URLs only.
    · https://example.com/spring-into-summer/

  ! og:image is WebP ×17
    LinkedIn does not render WebP previews and WhatsApp is unreliable with it.
    · https://example.com/reformer-classes/
    …

  20 error  91 warning  12 note
```

Findings are grouped by check, not by page, because the fix is usually one change applied everywhere.

Some warnings are meant to be lived with. A contact page is *supposed* to be short; a privacy policy has no business carrying editorial links. The tool reports what is true and leaves the judgement to you — it has no way to know which pages are meant to rank.

---

## Use with

| Tool | For |
|---|---|
| [PageSpeed Insights](https://pagespeed.web.dev) | Core Web Vitals, render-blocking resources, image sizing in practice |
| [WebPageTest](https://webpagetest.org) | The same, from a location your customers actually live in |
| [Rich Results Test](https://search.google.com/test/rich-results) | Whether Google parses your structured data, not just whether it is valid |
| [Search Console](https://search.google.com/search-console) | What Google has actually indexed. The only opinion that counts |
| [Ahrefs Webmaster Tools](https://ahrefs.com/webmaster-tools) | Backlinks — free for domains you verify |

---

## Versioning

Releases follow [semver](https://semver.org). Three ways to pin, in order of
how much you value stability over freshness:

| Reference | Gets you |
|---|---|
| `@v1` | The latest release that is backwards compatible. Moves forward with each one. Recommended |
| `@v1.19.0` | Exactly that release, forever |
| `@main` | Whatever was last pushed, including work in progress |

The same applies to `npx github:nurkamol/seo-audit#v1`.

---

## Contributing

Adding a check means one entry in `src/checks.mjs` (per page), `src/checks.mjs → crossPageChecks` (needs every page), or `src/site.mjs` (once per domain). Each returns `{ level, id, title, detail, url }` and that is the whole contract.

Two rules that keep the tool trustworthy:

1. **No false positives.** A check that cries wolf gets the whole report ignored. If a pattern is sometimes legitimate, it is a `note`, not an `error`.
2. **No dependencies.** It must keep running with a bare `npx` on a machine with nothing installed.

See [ROADMAP.md](ROADMAP.md) for what is planned, [CHANGELOG.md](CHANGELOG.md) for what changed.

## Licence

MIT
