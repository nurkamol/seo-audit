# Contributing

```bash
git clone https://github.com/nurkamol/seo-audit && cd seo-audit
npm test                                   # 57 tests, no install needed
node bin/seo-audit.mjs https://example.com
```

There is nothing to install and no build step. The test suite serves its own
fixture site over localhost, so it runs offline and never depends on a real
site staying broken in the same way.

## Adding a check

Return `{ level, id, title, detail, url }` from one of three places:

| Where | For |
|---|---|
| `pageChecks` in `src/checks.mjs` | Needs only this page |
| `crossPageChecks` in `src/checks.mjs` | Needs every page at once |
| `src/site.mjs` | Once per domain, or needs the link graph |

Then, in the same change: add a row to the README's check table, a line to
`CHANGELOG.md`, and a test in `test/unit.test.mjs` — with a case that proves
it does **not** fire when it shouldn't, which is the half that matters.

## The three rules

1. **No dependencies.** It has to keep working with a bare `npx` on a machine
   with nothing installed. That rules out an HTML parser and a headless
   browser, and it is why `src/parse.mjs` is careful regexes.
2. **No false positives.** A check that cries wolf gets the whole report
   ignored. If a pattern is sometimes legitimate it is an `info`, never an
   `error`. When a real site produces a finding that is technically true and
   practically useless — footer headings counted in a page's outline, say —
   that is a bug in the check.
3. **Performance is never estimated.** `--psi` asks Google. A `fetch` loop
   cannot see rendering, and a confident wrong number is worse than silence.

## Severity

| | |
|---|---|
| `error` | Wrong, and costing traffic or breaking something |
| `warn` | Worth fixing, judgement involved |
| `info` | Worth knowing, may well be deliberate |

If you are unsure, it is one level lower than you think.
