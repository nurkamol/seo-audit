# SEO Audit for Raycast

Three commands. The same engine as the command line, the GitHub Action, the
macOS app and the hosted Worker — imported, not reimplemented.

```
Preview a Site     how big is this, and is it the right one — ~1s, 3 requests
Audit a Site       crawl it and list what to change, worst first
Recent Reports     runs the macOS app has already kept
```

## Why Preview is first

A full crawl takes minutes and a launcher is built for the second you spend in
it. Running a seven-minute job behind a keystroke is the obvious idea and the
wrong one — you close the window and it is gone.

`Preview` is the engine's `--dry-run`: it settles the host, reads robots.txt and
the sitemap, and stops.

```
210 URLs listed     25 would be checked · 185 past the limit of 25
/docs/              35 URLs
/news/2016/         18 URLs
3 requests, 1.4s    No page was fetched.
```

That is the question somebody actually has before spending the minutes, and it
fits in a launcher exactly.

`Audit` is capped by preference — 25 pages by default. A thousand-page site
belongs in the app or the terminal, and the empty state says so rather than
leaving somebody watching a spinner.

## It reimplements nothing

```ts
import { preview } from "../../src/audit.mjs";
```

The same line `worker/index.mjs` uses. Levels, thresholds, grouping, ordering
and the scope sentences all arrive from the engine; this arranges them into
rows. A report from Raycast and one from `seo-audit --json` are the same report,
which is the rule that lets this project have five front ends at all.

Raycast runs Node, so unlike the hosted Worker this gets `node:tls` and the
certificate checks work here.

**Two things are duplicated**, and both have tests. The three named speeds:
Swift's `CrawlSettings.Speed` and `SPEEDS` in `lib/present.mjs` are the same
numbers in two languages, and two people reading "Gentle" in two windows should
get the same crawl. And the browser and system menus, because a dropdown in a
static manifest cannot read `src/agents.mjs` at runtime — `npm test` fails if
either drifts.

## What it reaches

Every flag that shapes a run, through `⌘,` preferences:

| | |
|---|---|
| Pages per run | `--limit`, capped — a launcher is a poor place to wait out a thousand pages |
| Speed | `--concurrency` as Gentle / Normal / Fast |
| Outbound links | `--check-external` |
| Sitemap | `--sitemap` |
| Exclude | `--exclude`, one pattern per line or comma separated |
| Only what changed since | `--since` |
| Identify as / On / Or your own | `--browser`, `--os`, `--user-agent` |
| Performance | `--psi`, `--psi-sample`, `--psi-strategy` |
| Silenced checks | `--ignore` — copy an id off any finding with `⌘.` |

**Export** (`⌘E`) writes HTML, Markdown, CSV, JSON or the corrected sitemap to
`~/Downloads`, using the engine's own writers — the same `html()`, `markdown()`
and `csv()` the command line calls. When the engine refuses to build a sitemap,
because the crawl did not see the whole site, the refusal is shown rather than a
file that would delete pages from somebody's site.

Anything left at its default is **not sent**, so the engine's defaults stay
written down in the engine.

Not reachable, and each for a reason: `--baseline` and `--against` want two runs
picked and compared, which is a screen rather than a preference; `--compare-as`
fetches a sample twice; `--settle` waits out a deploy; `--redirects` and
`--config` are files a repository commits; `--fail-on` needs an exit code a
launcher does not have; `--search-console` needs an OAuth client and has never
run against the live API.

## `@raycast/api` is a dependency, and only here

The command line has none and never will: `npx github:nurkamol/seo-audit` is the
whole install story. This folder is the same arrangement `worker/` has with
Wrangler — the dependency belongs to the front end, is installed only by
somebody developing *this*, and never reaches the npx payload. `raycast/` is
absent from `files` in the root `package.json` for the same reason `worker/` is.

## Working on it

```bash
cd raycast
npm install
npm run dev      # ray develop — opens Raycast against this folder
npm run lint
```

The half that is not React lives in `lib/present.mjs` and is plain ESM with no
`@raycast/api` import anywhere in it, so `node --test` can run it —
`test/raycast.test.mjs`, from the repository root, along with everything else.
The components are thin over it on purpose: what can be wrong quietly is a
preference that parses to `NaN` pages, a library row pointing at a file that is
gone, or a refusal drawn as a result, and all three are in the tested half.

## Types

`lib/engine.ts` is the only place that says what the engine returns. The engine
is plain ESM with no declarations and stays that way — the command line's whole
premise is that it runs under `npx` with nothing installed, and emitting types
would mean a build step. TypeScript infers something from the JavaScript and
what it infers is narrower than the truth, so that file widens it, once.

It ends in three assertions rather than annotations, and the reason is written
there: `level` is one of exactly three strings — every `f('warn', …)` in
`src/checks.mjs` passes a literal — but TypeScript reading plain JavaScript can
only see `string`. The narrow type is true and unprovable from here. The
alternative is `string` everywhere, re-narrowed at every icon lookup in every
component: one honest assertion traded for several dishonest ones. What keeps it
from rotting is `test/raycast.test.mjs`, which runs against the real engine
rather than against the types.

`lib/present.d.mts` does the same for `present.mjs`, which stays `.mjs` so
`node --test` can run it.
