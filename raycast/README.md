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

**One thing is duplicated**, and it has a test: the three named speeds. Swift's
`CrawlSettings.Speed` and `SPEEDS` in `lib/present.mjs` are the same three
numbers in two languages, and `npm test` fails if they drift, because two people
reading "Gentle" in two windows should get the same crawl.

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

## What has not been run

Honestly: the React surface. Building a Raycast extension needs `@raycast/api`
installed and the Raycast CLI, and nothing here has been through `ray build`.
The engine path, the preferences, the row-building and the library reading have
all been exercised against real sites and real files; the components have been
written and not launched. First person to run `npm run dev` should expect to
find something.
