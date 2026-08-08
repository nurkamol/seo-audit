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
| `--md <file>` | — | Also write a Markdown report |
| `--limit <n>` | 200 | Maximum pages to check |
| `--concurrency <n>` | 6 | Parallel requests |
| `--sitemap <url>` | auto | If it isn't at `/sitemap-index.xml` or `/sitemap.xml` |
| `--fail-on <level>` | `error` | Exit 1 at `error`, `warn`, or `never` |
| `--quiet` | — | Print nothing; use the exit code and `--md` |

### In CI

Exit code is 1 when findings reach `--fail-on`, so a regression fails the build:

```yaml
- run: npx github:nurkamol/seo-audit https://example.com --fail-on error --md audit.md
- uses: actions/upload-artifact@v4
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

### Whole site

| Check | Level |
|---|---|
| `robots.txt` exists, does not block everything, advertises the sitemap | error / warning / note |
| `llms.txt` exists | note |
| `http://`, `www.` and `https://www.` each reach the canonical host in one hop | warning |
| HSTS, `X-Content-Type-Options`, `Referrer-Policy`, CSP headers | warning / note |
| Every internal link resolves — the site-wide 404 sweep | error |
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

## Contributing

Adding a check means one entry in `src/checks.mjs` (per page), `src/checks.mjs → crossPageChecks` (needs every page), or `src/site.mjs` (once per domain). Each returns `{ level, id, title, detail, url }` and that is the whole contract.

Two rules that keep the tool trustworthy:

1. **No false positives.** A check that cries wolf gets the whole report ignored. If a pattern is sometimes legitimate, it is a `note`, not an `error`.
2. **No dependencies.** It must keep running with a bare `npx` on a machine with nothing installed.

See [ROADMAP.md](ROADMAP.md) for what is planned, [CHANGELOG.md](CHANGELOG.md) for what changed.

## Licence

MIT
