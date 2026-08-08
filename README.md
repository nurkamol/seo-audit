<p align="center">
  <img src="docs/logo.svg" alt="seo-audit" width="440">
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
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  </a>
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

## Usage

```bash
# Crawl and print to the terminal
npx github:nurkamol/seo-audit https://example.com

# Save a Markdown report you can commit, diff, or send to a client
npx github:nurkamol/seo-audit https://example.com --md audit.md

# Audit a local build before it ships
npm run preview &
npx github:nurkamol/seo-audit http://localhost:4321 --limit 50
```

### Options

| Option | Default | |
|---|---|---|
| `--md <file>` | — | Write a Markdown report |
| `--html <file>` | — | Write a self-contained HTML report — one file, no assets |
| `--json <file>` | — | Write a JSON report — also usable as a baseline |
| `--baseline <file>` | — | Compare against a previous `--json` run; show only what changed |
| `--update-baseline` | — | Rewrite the baseline after comparing |
| `--limit <n>` | 200 | Maximum pages to check |
| `--concurrency <n>` | 6 | Parallel requests |
| `--sitemap <url>` | auto | If `robots.txt` doesn't declare one and it isn't at a usual path |
| `--user-agent <ua>` | `seo-audit …` | Identify as something else |
| `--config <file>` | `seo-audit.config.json` | Per-site configuration |
| `--ignore <ids>` | — | Comma-separated check ids to silence for this run |
| `--psi <urls>` | — | Measure these pages with PageSpeed Insights (see below) |
| `--psi-strategy` | `mobile` | `mobile` or `desktop` |
| `--against <url>` | — | Compare against another deployment now — preview vs production |
| `--settle <s>` | — | Wait until the site serves consistent HTML before crawling |
| `--fail-on <level>` | `error` | Exit 1 at `error`, `warn`, `new`, or `never` |
| `--version` | — | Print the version |
| `--quiet` | — | Print nothing; use the exit code and the files |

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
  "psi": ["/", "/pricing/"],
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

- **`limits`** — thresholds this site disagrees with: `titleMin`, `titleMax`,
  `descMin`, `descMax`, `thinWords`, `slowMs`.
- **`psi`** — pages to measure with PageSpeed Insights, as paths.
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

## What it checks

Findings come at three levels: **error** (wrong, and costing traffic), **warning** (worth fixing, judgement involved), **note** (worth knowing, may be deliberate).

### Per page

| Check | Level |
|---|---|
| Page returns 200 and is not a redirect listed in the sitemap | error |
| `noindex` on a page the sitemap advertises | error |
| `<title>` present, 15–60 characters | error / warning |
| Meta description present, 70–160 characters | warning |
| Exactly one `<h1>` | error / warning |
| `lang` attribute and viewport meta | warning / error |
| Canonical present, single, self-referencing | warning / error / note |
| `og:title`, `og:description`, `og:image` present | warning |
| `og:image` is not WebP — LinkedIn won't render it, WhatsApp is unreliable | warning |
| `og:image` declares width and height | note |
| JSON-LD parses and carries a `@type` (or a `@graph`) | error / warning |
| Every `<img>` has an `alt` attribute (empty is correct for decorative) | error |
| Every `<img>` has `width` and `height` — otherwise the page reflows | warning |
| Images offer a `srcset` rather than one size for every screen | note |
| Word count above ~300 | warning |
| At least one link inside the content, not just navigation | note |
| No `http://` resources on an HTTPS page | error |

### Across pages

| Check | Level |
|---|---|
| No two pages share a title | warning |
| No two pages share a meta description | warning |
| `hreflang` is reciprocal — Google drops one-way pairs | error |
| Pages carry the schema types `expect` says they should | error |
| No page is an orphan — in the sitemap but linked from nowhere | warning |

### Whole site

| Check | Level |
|---|---|
| `robots.txt` exists, does not block everything, advertises the sitemap | error / warning / note |
| `llms.txt` exists | note |
| `http://`, `www.` and `https://www.` each reach the canonical host in one hop | warning |
| HSTS, `X-Content-Type-Options`, `Referrer-Policy`, CSP headers | warning / note |
| Every internal link resolves — the site-wide 404 sweep | error |
| No page is linked but missing from the sitemap | warning |
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
| `@v0.3.0` | Exactly that release, forever |
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
