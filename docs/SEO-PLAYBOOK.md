# Technical SEO playbook

A working checklist for taking a site from "probably fine" to genuinely clean,
written from the things that were actually wrong on real projects rather than
from a list of best practices. Ordered by how much each one moves the needle.

Copy this file into a new project's `docs/`, work down it, and check things
off. Run [`seo-audit`](https://github.com/nurkamol/seo-audit) as you go — it
verifies about two thirds of what follows automatically.

```bash
npx github:nurkamol/seo-audit@v1 https://example.com --html audit.html
```

**Scope, stated once.** Everything here is on-site technical and content
correctness. It makes a site *eligible* to rank. What decides the actual
ordering is off-site — links, a Business Profile, reviews, and content people
want. Anyone promising rankings from a checklist is selling something. See
[Off-site](#off-site-the-part-a-checklist-cannot-do) at the bottom for what
that work actually is.

---

## 1. Crawlability and indexing

The floor. Everything else is wasted if this is wrong.

- [ ] `robots.txt` exists, does not `Disallow: /`, and declares the sitemap
- [ ] A sitemap exists and lists **final URLs only** — no redirects, no
      `noindex` pages, no non-HTML files
- [ ] Staging hosts serve `noindex` *and* a `Disallow: /` robots.txt, decided
      by hostname so it flips automatically at cutover
- [ ] Production serves neither — check this after any staging work
- [ ] `http://`, `www.` and `https://www.` each reach the canonical host in
      **one** hop
- [ ] Trailing slashes are consistent: one form 200s, the other redirects.
      Both answering 200 is two URLs for one page
- [ ] Every page has a self-referencing canonical, and only one
- [ ] Canonicals point at URLs that return 200 — not a redirect, not a 404
- [ ] `llms.txt` describes the site for AI assistants ([the convention](https://llmstxt.org))

> **Trap.** A sitemap entry that 301s is not harmless: it tells Google your own
> map of the site is out of date. Regenerate the sitemap from routes, never by
> hand.

## 2. The pages themselves

- [ ] Every page: exactly one `<h1>`, and it is in the content, not the header
- [ ] Heading levels descend one at a time within `<main>` — no `h1` → `h3`
- [ ] Titles are unique, 15–60 characters, and carry the term someone would
      actually search plus the location if the business is local
- [ ] Meta descriptions are unique and 70–160 characters — longer gets cut off
      mid-sentence in results
- [ ] `lang` on `<html>`, and a viewport meta
- [ ] No page that matters is under ~300 words. A 120-word page with a
      competitive title cannot rank, and no amount of technical work changes
      that

> **Trap.** Don't pad a title to hit a character count. "48 characters" is not
> a problem; a title that omits what the page is about is.

## 3. Internal linking

The highest-value item most sites are missing entirely, and the one no
single-page grader can see.

- [ ] Pages link to each other **from inside the content**, not only from the
      nav and footer
- [ ] Long-form articles link to the product, service or page they discuss
- [ ] Related pages cross-link where the copy already names the other thing —
      anchor existing wording rather than writing "click here"
- [ ] No orphans: every page in the sitemap is linked from somewhere
- [ ] No page linked from the site is missing from the sitemap
- [ ] Every internal link resolves — run a full-site 404 sweep, not a spot check

> **How to check quickly.** If every page reports the same number of internal
> links, they are all nav and footer, and the content links to nothing.

## 4. Multilingual

Skip if the site is one language. If it isn't, this is where the silent
breakages live.

- [ ] `hreflang` on every page, **reciprocal** — if A points at B, B must point
      back, or Google ignores the pair
- [ ] `x-default` points at the language a stranger should land on
- [ ] Slugs may differ per language — a Russian article should have a Russian
      URL
- [ ] **The language switcher uses the page's real translation, not a path
      swap.** This is the single most expensive bug on this list

> **Trap, and a true story.** A site swapped the `/ru` prefix on the current
> path to build its language switcher. That works for mirrored pages and 404s
> for every article whose translation has its own slug. `hreflang` was correct,
> so Google knew the right pairing while every human visitor hit a dead page.
> Three commercial SEO tools audited that site the same morning and none saw
> it, because the link is only broken on pages they never opened.

## 5. Images

- [ ] Every `<img>` has an `alt` attribute — `alt=""` for decoration, a real
      description otherwise. The attribute must exist either way
- [ ] Every `<img>` has `width` and `height`, so the browser reserves the box
      and the page doesn't reflow as images arrive
- [ ] **`img { height: auto }` is in the CSS.** With dimensions set and no
      `height: auto`, the browser treats the height attribute as a literal
      pixel height and images render stretched
- [ ] `srcset` + `sizes` so a phone doesn't download the desktop file. Typical
      saving: 60 KB → 12 KB per card image
- [ ] Modern formats (WebP/AVIF) for on-page images
- [ ] `loading="lazy"` below the fold, and **never** on the LCP image
- [ ] The LCP image is preloaded in `<head>` with `fetchpriority="high"`
- [ ] **A preload must carry the same candidates as the element's `srcset`**
      (`imagesrcset` / `imagesizes`), or the browser fetches the full-size
      original *and then* the variant it actually wanted

> **On decorative images.** If the container is `aria-hidden`, a screen reader
> never reaches the image whatever its alt says. So an empty alt there costs
> nothing — and gains nothing. A real description costs nothing either and
> makes the photography eligible for image search. Describe the picture, not
> the page title.

## 6. Social previews

- [ ] Every page has `og:title`, `og:description` and `og:image`
- [ ] `og:image` is **1200×630** and **JPEG or PNG** — LinkedIn does not render
      WebP and WhatsApp is unreliable with it
- [ ] `og:image:width`, `height` and `type` are declared on every page, not
      just the default
- [ ] Each page previews with its own image, not one generic card
- [ ] `twitter:card` is `summary_large_image`
- [ ] Generate the crops at build time from the page's own photo, and fail the
      build if a page references one that wasn't produced

> Worth doing: composite the logo onto the generated crop over a soft gradient.
> One image then works over both a dark photograph and a bright one, and a
> shared link is recognisable before anyone reads the title.

## 7. Structured data

- [ ] `Organization` or `LocalBusiness` + `Person` + `WebSite`, emitted once,
      on the home page. A `@graph` is valid and Google reads it
- [ ] `LocalBusiness` carries name, URL, telephone, email, address, areaServed,
      a real photo, and `sameAs` for every social profile
- [ ] `hasOfferCatalog` lists the services, each linking to its own page
- [ ] `Service` on service pages, `BreadcrumbList` where there's a hierarchy
- [ ] `FAQPage` on a Q&A page — with the markup **stripped** from the answer
      text, so Google isn't shown `[link](/path/)`
- [ ] `BlogPosting` on articles with `datePublished` **and** `dateModified`
- [ ] It validates: [Rich Results Test](https://search.google.com/test/rich-results)
      and [validator.schema.org](https://validator.schema.org)

> **Do not** add `aggregateRating` built from testimonials hosted on your own
> site. Google disallows self-serving review markup and it risks a manual
> action. Reviews belong on the Business Profile.
>
> **Do not** invent `geo`, `openingHours` or `priceRange` because a validator
> wants them. Wrong data in front of Google is worse than absent data.

## 8. Performance

Measure it, don't estimate it — [PageSpeed Insights](https://pagespeed.web.dev)
and [WebPageTest](https://webpagetest.org) run real browsers, and WebPageTest
lets you pick a location your customers actually live in.

- [ ] Fonts are **self-hosted**, subsetted to the scripts the site uses
- [ ] Only the faces that set first paint are preloaded, in the subset that
      page needs — a Cyrillic page has no use for the Latin cut
- [ ] No render-blocking third-party stylesheet
- [ ] Third-party JavaScript is justified per script. Analytics that nobody
      reads is pure cost — a single tag manager is routinely 160 KB
- [ ] Consent Mode or equivalent: storage denied until the visitor accepts
- [ ] CLS under 0.1 — mostly solved by image dimensions
- [ ] Cache headers on hashed assets

> **Trap.** Self-hosting fonts removes a render-blocking request and a privacy
> problem. It does **not** make the files smaller. If the total is still 250 KB
> across six faces, subset them or drop the ones barely used.

## 9. Trust and credibility (E-E-A-T)

The half that isn't code, and the half most sites skip.

- [ ] Articles show an author and a visible date
- [ ] The author has a real bio somewhere, with credentials, and the article
      links to it
- [ ] Testimonials are attributed — a first name and context beats "★★★★★"
- [ ] Contact details, a physical presence if there is one, and clear legal
      pages
- [ ] Legal pages have real titles and descriptions, not "Disclaimer"
- [ ] Nothing overstates what the business can do. For anything health-adjacent
      this is a ranking factor, not just ethics

## 10. Local business

- [ ] **Google Business Profile claimed and complete.** For a local service
      this outweighs the entire website in map results
- [ ] Name, address and phone identical on the site, the Profile, and every
      directory
- [ ] A `tel:` link and the locality visible on the site itself
- [ ] Reviews requested from real clients, on the Profile — never on your own
      site marked up as ratings

---

## Off-site: the part a checklist cannot do

Being honest about this is the difference between a useful engagement and an
expensive one.

| Lever | Reality |
|---|---|
| Backlinks | The strongest signal, and the hardest. Directories, partners, guest articles, interviews. Zero referring domains means zero authority, however clean the HTML |
| Business Profile + reviews | For local search, the single biggest lever |
| Content depth | Publishing consistently, about things people search for |
| Time | A new domain does not rank quickly, whatever anyone says |

---

## Working process

The discipline that keeps this from rotting after week one.

1. **Baseline before you start.**
   ```bash
   npx github:nurkamol/seo-audit@v1 https://example.com --json seo-baseline.json
   ```
   Commit `seo-baseline.json`.

2. **Configure what the site lives with.** Every site has findings that are
   true and deliberate — a contact page is meant to be short, a privacy policy
   has no business carrying editorial links. Put them in
   `seo-audit.config.json` (see below) so the report stays readable.

3. **Gate CI on regressions, not on the backlog.**
   ```yaml
   - uses: nurkamol/seo-audit@v1
     with:
       url: https://example.com
       baseline: seo-baseline.json
       fail-on: new
       comment: true
   ```

4. **Wait for the edge before auditing.** A CDN serves a fresh deploy unevenly
   for a minute or two — one POP has the new page, another the old, and 404s on
   new assets get cached briefly. Auditing during that window produces a
   snapshot that is wrong in a way nobody can reproduce. Use `--settle 60`, or
   poll until several consecutive requests agree.

5. **Re-run the external tools after real changes**, not before. They cache
   reports, and their categories differ from Google's: several count `alt=""`
   as missing, and one will insist a site has no CSS media queries while
   another scores its mobile experience 100.

---

## Starter config

`seo-audit.config.json` in the project root:

```json
{
  "limit": 200,
  "failOn": "error",
  "limits": { "thinWords": 300 },
  "psi": ["/"],
  "ignore": [
    { "id": "thin-content", "urls": ["/contact/", "/thanks/", "**/legal/**"] },
    { "id": "no-editorial-links", "urls": ["**/privacy-policy/", "**/terms-of-use/", "**/cookie-policy/"] }
  ],
  "expect": [
    { "urls": ["/"], "types": ["Organization", "WebSite"] },
    { "urls": ["/blog/*/"], "types": ["BlogPosting"] },
    { "urls": ["/faq/"], "types": ["FAQPage"] }
  ]
}
```

Every `ignore` entry should be defensible out loud. If you can't say why a
finding is acceptable, fix it instead of hiding it.

---

## Handing this to an AI agent

Drop this file in `docs/` and give the agent something like:

> Read `docs/SEO-PLAYBOOK.md`. Run
> `npx github:nurkamol/seo-audit@v1 <url> --html audit.html --json audit.json`
> against this project, then work through the playbook section by section.
> For each item: check whether it is true of this codebase, fix it if not, and
> tell me which items you could not verify or that need a decision from me.
> Do not invent business facts — addresses, opening hours, prices, credentials.
> Verify each fix against the built output before moving on, and wait for the
> CDN to settle before auditing a fresh deploy.

The last two sentences matter more than the rest. Most of the damage an
enthusiastic pass does is inventing structured data that isn't true, and
declaring success against a stale cache.
