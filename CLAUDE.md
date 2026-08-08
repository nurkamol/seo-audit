# seo-audit — working notes

A zero-dependency CLI that crawls a site's sitemap and checks every page.
Public repo. Built because every free SEO grader audits only the homepage.

## Run it

```bash
node bin/seo-audit.mjs https://example.com               # terminal report
node bin/seo-audit.mjs https://example.com --html r.html --md r.md --json r.json
node bin/seo-audit.mjs https://example.com --psi https://example.com/
```

Node 22 (`nvm use 22`). There is nothing to install and no build step. There
are no unit tests — the tool is validated by running it against real sites,
which is the only thing that has ever found a real bug in it.

## Three rules that are not negotiable

1. **No dependencies.** It must keep working with a bare `npx` on a machine
   with nothing installed. That rules out an HTML parser, a headless browser,
   and every convenience library. `src/parse.mjs` uses narrow regexes over
   well-formed generated markup on purpose.
2. **No false positives.** A check that cries wolf gets the entire report
   ignored. If a pattern is sometimes legitimate, it is an `info`, never an
   `error`. Cloudflare's `/cdn-cgi/l/email-protection` taught this one — it
   404s to non-browsers by design.
3. **Performance is never estimated.** A `fetch` loop cannot see rendering,
   and a plausible wrong number is worse than no number. `--psi` is not an
   exception to this: it asks Google for Google's own measurement.

## Where things live

| File | |
|---|---|
| `bin/seo-audit.mjs` | CLI: flags, config merge, baseline compare, exit code |
| `src/audit.mjs` | Orchestration — discover sitemap, fetch pages, run checks |
| `src/http.mjs` | Fetching. Redirects are **not** followed; a redirect is a finding |
| `src/parse.mjs` | HTML extraction |
| `src/checks.mjs` | Per-page checks, and cross-page checks needing every page |
| `src/site.mjs` | Once-per-domain checks, link sweep, og:image reachability |
| `src/config.mjs` | Config file, ignore rules, URL globs, schema expectations |
| `src/psi.mjs` | PageSpeed Insights |
| `src/baseline.mjs` | Serialise and diff runs |
| `src/report.mjs` | Terminal, Markdown, HTML, and the baseline diff view |

## Adding a check

Return `{ level, id, title, detail, url }` from the right place — that is the
whole contract. Per-page goes in `pageChecks`, anything needing the full set
in `crossPageChecks`, anything once-per-domain in `src/site.mjs`.

Then, in the same change: add the row to the README's check table, and an
entry to `CHANGELOG.md`. The README table is the tool's documentation of
record and drifts immediately if this is skipped.

## Releasing

```bash
# bump version in package.json, write the CHANGELOG entry, then:
git tag -a v0.4.0 -m "…" && git push --follow-tags
gh release create v0.4.0 --title "…" --notes-file <changelog section>
git tag -f -a v1 -m "…" && git push -f origin v1   # only if compatible
```

`v1` floats forward with every backwards-compatible release, because projects
reference `uses: nurkamol/seo-audit@v1`. A breaking change — a renamed flag, a
different exit code, a changed config shape — becomes `v2`, and `v1` stops
moving. Do not move `v1` past a breaking change.

## Secrets

The PageSpeed Insights key lives in `~/.config/seo-audit/.env` as
`PSI_API_KEY`, deliberately outside this repository because it is public.
`src/psi.mjs` reads the env var first and that file second. Never commit a
key, and never paste one into an issue or a report.

## Context

Written after three commercial graders all reported a client site's homepage
as healthy while the language switcher on every translated article linked to
a 404 — a bug none of them could see, because it was only wrong on pages they
never opened. That is the tool's reason to exist; keep it in mind when
weighing whether a proposed check is worth the noise it will make.

Client URLs do not belong in this repository. The example in the README and
the self-check workflow point at sites chosen for that purpose.
