# seo-audit — working notes

A zero-dependency CLI that crawls a site's sitemap and checks every page.
Public repo. Built because every free SEO grader audits only the homepage.

## Run it

```bash
node bin/seo-audit.mjs https://example.com               # terminal report
node bin/seo-audit.mjs https://example.com --html r.html --md r.md --json r.json
node bin/seo-audit.mjs https://example.com --psi https://example.com/
node bin/seo-audit.mjs https://example.com --psi "/journal/**" --psi-sample 3
node bin/seo-audit.mjs https://example.com --verbose             # watch it work
npm test                                                # the engine; no install, any platform
npm run test:all                                        # and the macOS app's own suite
```

Node 22 (`nvm use 22`). There is nothing to install and no build step.

There are **two** suites and `npm test` runs one of them. `node --test` over
`test/` is portable and needs nothing installed, which is the premise; the app's
own suite is `swift test` over `mac/Tests/` and needs a toolchain most machines
touching this repo do not have. `npm run test:all` runs both and says plainly
when it could not run the second, because a suite that was skipped reads exactly
like a suite that passed. 1.34.0 published while `swift test` was failing on
main, which is why that script exists.

`npm test` runs `node --test` over `test/`, serving its own fixture site on
localhost so it works offline and cannot be broken by a real site changing.
The suite is necessary and not sufficient: every real bug this tool has ever
had was found by running it against a real site, so do that too before calling
a change done. Writing the tests found one immediately — `\b` treats the hyphen
in `data-src` as a word boundary, so a lazy-loading site had its `data-src`
read as its `src`.

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
| `src/prompt.mjs` | The questions asked when the bare command is run — never in CI |
| `src/redirects.mjs` | A migration's redirect map, checked against the live site |
| `src/robots.mjs` | robots.txt, as Google reads it — `Allow` beats `Disallow` on a longer pattern, and a tie goes to `Allow` |
| `src/config.mjs` | Config file, ignore rules, URL globs, schema expectations, portfolio resolution |
| `src/psi.mjs` | PageSpeed Insights |
| `src/baseline.mjs` | Serialise and diff runs |
| `src/report.mjs` | Terminal, Markdown, HTML, the baseline diff view, and the portfolio table |
| `raycast/` | The Raycast extension. Imports the engine as `@nurkamol/seo-audit`, never `../../src` — a Store submission is that folder and nothing above it. `npm test` symlinks the package so a checkout still builds. After touching anything in there run `npm run lint` **in that folder**: `npm test` does not, and `ray publish` refuses on a Prettier complaint the build is happy with |
| `desktop/` | The Tauri shell for Windows and Linux. It draws nothing: it starts `bin/seo-audit.mjs --serve 0`, reads the port off stdout and points a webview at it — the same thing `mac/SeoAudit/Engine.swift` does, in Rust. Needs a Rust toolchain; `npm run test:all` runs its tests and says so when it cannot. A control added here instead of to the served HTML is a control Windows has and macOS does not |
| `worker/index.mjs` | The optional hosted front end. Imports `audit` and `html`; re-implements nothing. Web-standard APIs only, so `node --test` can run it |

## Adding a check

Return `{ level, id, title, detail, url }` from the right place — that is the
whole contract. Per-page goes in `pageChecks`, anything needing the full set
in `crossPageChecks`, anything once-per-domain in `src/site.mjs`.

Then, in the same change: add the row to the README's check table, an entry to
`CHANGELOG.md`, and a test in `test/unit.test.mjs` — including a case proving
it does **not** fire when it shouldn't, which is the half that matters. The
README table is the tool's documentation of record and drifts immediately if
this is skipped.

## Adding a flag

Three places, and the third is enforced.

1. `bin/seo-audit.mjs` — parse it, and add it to the help text.
2. `action.yml` — as an input *and* in the `args+=` block that assembles the
   command. An input that never reaches the CLI is worse than no input, because
   it fails silently.
3. `src/options.mjs` — say whether the macOS window should reach it. `app: true`
   if it does; otherwise a **sentence** saying why not. "Not yet" is a fine
   answer as long as it is written down and says something — the test rejects a
   bare `'not yet'`.

`npm test` fails until (3) is done, in both directions: a flag with no entry, an
entry for a flag that no longer exists, an entry claiming the window sends a
parameter that `CrawlSettings.swift` does not, and a parameter the window sends
that no flag corresponds to. That last one is a setting that quietly does
nothing, which is the worst of the four.

The Node test reads the Swift source, which is unusual and deliberate: a
macOS-only CI job would fail hours later on somebody else's machine, and this
has to fail on the machine of whoever added the flag, at the moment they add it.

The table is served at `/options` as well, so "can the app do X" is a question
with a fetchable answer rather than one that needs a source file read.

If the check reaches for a Node built-in, it will vanish in the Worker — read
the next section before you write it.

## The hosted Worker

Optional, and not on the main path — the CLI is. Two rules keep it honest:

1. **It never re-implements a check.** It imports `audit` and `html`. If a
   report from the Worker can differ from a report from the CLI, that is a bug.
2. **When it cannot run a check, it says so in the report.** `tls-expiring` and
   `tls-expired` need a socket the runtime does not have, so a `tls-not-checked`
   note goes into every hosted report. A missing finding reads exactly like a
   passing one. Anything else that turns out not to work there gets the same
   treatment, never a silent omission.

`worker/`, `raycast/` and `desktop/` are deliberately absent from `files` in
`package.json`: the npx payload stays the CLI, and the deploy flow clones the
repository anyway. `@raycast/api` is the same arrangement as Wrangler — a front
end's dependency, installed only by somebody working on that front end, never
reaching anybody who runs `npx github:nurkamol/seo-audit`.
Wrangler is never a dependency — Cloudflare runs `npx wrangler deploy` on their
side. To try it locally you need Node 22 (wrangler refuses below that, even
though the CLI itself is happy on 18):

```bash
npx wrangler dev --var AUDIT_TOKEN:whatever ALLOWED_HOSTS:example.com
npx wrangler deploy --dry-run     # proves the bundle still builds
```

Costs, limits and the risk statement live in `docs/hosting.md`. Numbers there
are dated and sourced; if you change one, re-check it against Cloudflare's
pricing page rather than trusting the sentence you are editing.

## Releasing

```bash
# bump version in package.json, write the CHANGELOG entry, then:
git tag -a v0.4.0 -m "…" && git push --follow-tags
git tag -f -a v1 -m "…" && git push -f origin v1   # only if compatible
```

That is the whole procedure. Pushing the version tag runs three workflows and
none of them needs a hand:

- **`macOS app`** builds and signs the app, **creates the GitHub release** if it
  does not exist — titled from the tag's annotation, with that version's
  CHANGELOG section as the notes — attaches the zip, and points the Homebrew
  cask at the checksum it just built. Write the CHANGELOG entry before tagging
  and the release writes itself; forget to, and the job says so in a warning and
  falls back to generated notes rather than failing with the app already built.
- **`npm`** publishes `@nurkamol/seo-audit` with provenance, and skips silently
  if that version is already on the registry.
- **`test`** runs the suite against the tag.

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
