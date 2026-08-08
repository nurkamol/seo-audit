# seo-audit

Crawl a site's sitemap and check **every page** for the SEO and metadata problems that single-page graders miss.

```bash
npx github:nurkamol/seo-audit https://example.com
```

No install, no dependencies, no account. Node 18+.

---

## Why this exists

The free audit tools — SEOptimer, SEO Site Checkup, Seomator and the rest — grade **one URL**, almost always the homepage. They will tell you your title tag is 48 characters and your homepage loads in 0.38 seconds, and they will happily award a B+ to a site where page 23 has a duplicate description, page 31 is 112 words long, and the language switcher links to a 404.

That last one is real. This tool's first run against a production site found the EN/RU switcher on every translated article pointing at a page that did not exist. Three commercial graders had audited the same site that morning and none could see it, because the broken link is only broken on pages they never opened.

**What this does:** correctness, across the whole site.
**What this deliberately does not do:** performance. [PageSpeed Insights](https://pagespeed.web.dev) and [WebPageTest](https://webpagetest.org) measure that with real browsers, from locations you choose. A `fetch`-based tool estimating Core Web Vitals would only be wrong with confidence.

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
| `--config <file>` | `seo-audit.config.json` | Per-site configuration |
| `--ignore <ids>` | — | Comma-separated check ids to silence for this run |
| `--psi <urls>` | — | Measure these pages with PageSpeed Insights (see below) |
| `--psi-strategy` | `mobile` | `mobile` or `desktop` |
| `--fail-on <level>` | `error` | Exit 1 at `error`, `warn`, `new`, or `never` |
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
    { "id": "thin-content", "urls": ["/contact/", "**/find-the-right-session/"] },
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
  42 pages · 64 requests · 4.2s

  ✗ Link to a page that does not exist ×4
    /journal/iskusstvo-chuvstvovat-glubzhe/ — linked from /ru/journal/iskusstvo-…
    · https://example.com/ru/journal/iskusstvo-chuvstvovat-glubzhe/
    …

  ! Thin page ×12
    112 words. Under ~300 rarely ranks for anything competitive.
    · https://example.com/contact/
    …

  4 error  12 warning  11 note
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
