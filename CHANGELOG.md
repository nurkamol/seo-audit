# Changelog

Notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Three enum variants warned on every build that they were never
  constructed.** Each is built under a `#[cfg]` — two on Windows, one on Linux —
  while every platform matches on all of them, because matching is not
  constructing. Silenced per variant and only where the claim is true, so a
  variant that stops being reachable on the platform that owns it still warns.

- **The first tagged release built its Windows and Linux bundles and then could
  not attach them.** `gh release upload` came back with "HTTP 403: Resource not
  accessible by integration" — the workflow never asked for `contents: write`,
  so its token was read-only. Twenty minutes of building, installing and running
  the bundles, all of it correct, and then a refusal on the last step.

  The same commit also matched tags with a bare `v*`, which matches the floating
  `v1` tag, so force-pushing `v1` started a second full build that would have
  spent fifteen minutes failing to attach bundles to a release named `v1`.

  Both mistakes were already solved elsewhere in this repository, and
  `mac-release.yml` carries a comment describing the second one exactly. So both
  are now checked by `test/workflows.test.mjs` rather than written down a third
  time: a tag trigger may not be a bare `v*`, and a workflow that writes to a
  release must ask for permission to.

### Added
- **Every release now says how to install it, on the page where it is
  downloaded.** The macOS app is ad-hoc signed rather than notarised — that
  needs a paid Apple Developer account this project does not have — so macOS
  quarantines the downloaded zip and Gatekeeper refuses it with *"SEO Audit is
  damaged and can't be opened"*, offering to move it to the Trash. It is not
  damaged, and that message reads exactly like malware.

  Homebrew never had this problem: the cask verifies the checksum and clears the
  flag. But the release page and the README's download badge both led somewhere
  that explained none of it. Both now do, with the checksum printed first, so
  clearing the flag is something done after verifying the file rather than on
  the say-so of a README.

  Windows gets the same treatment for SmartScreen, and the AppImage's `chmod +x`
  is written down rather than assumed.

- **Every file on a release has a published checksum.** The macOS zip always had
  one, because the Homebrew cask needs it. The `.deb`, the `.AppImage` and the
  `setup.exe` had none — so "check it before you wave the warning away" was
  advice you could not actually follow on the two platforms whose warning
  dialogs are the reason to say it. On Windows it reduced to "run it anyway".

  A `SHA256SUMS.txt` is attached to each release and the same lines are printed
  in its notes, so one command covers all four:

  ```bash
  shasum -a 256 --ignore-missing -c SHA256SUMS.txt
  ```

  Hashed from what is actually attached rather than from what each runner built,
  which also proves the upload arrived intact. One job rather than a step in each
  build: two matrix jobs editing the same release notes race, and the loser's
  edit is gone with nothing to show it.

- **The site says there are three apps now, and what to do when one will not
  open.** nurkamol.github.io/seo-audit offered a single "Download for macOS"
  button and described the app as macOS-only, which had been true for about a
  day. It now has a card per platform, the Homebrew route marked as the easier
  one, and a section for the warnings an unsigned build produces on macOS and
  Windows.

  The verify step and the quarantine command are two blocks with two copy
  buttons rather than one block with one, because a single paste that runs the
  checksum and then immediately clears the flag has verified nothing.

- **The desktop workflow can attach bundles to a tag it is given.** A release
  whose upload failed can be completed by running the workflow manually, rather
  than by force-moving a tag that people may already have fetched.

## [1.35.0] — 2026-08-29

### Added
- **A desktop app for Windows and Linux.** `desktop/` is a Tauri shell that
  starts `bin/seo-audit.mjs --serve 0`, reads the port off stdout and points a
  webview at it — exactly what `mac/SeoAudit/Engine.swift` has always done. It
  draws nothing: the report is the HTML the server already produces, so both
  platforms get the same sidebar, score ring and library, from the same folder
  on a machine that has both. The Swift app stays the macOS release.

  It carries the lessons of the window next door. Port zero, because guessing is
  how two copies fight over one. Node found by path rather than by `PATH`,
  because a window launched from a dock inherits almost none. And a failure that
  opens a window saying why, because an app that opens and does nothing is the
  worst version of that.

  A menu of File, Edit and Help — Edit predefined, because on Linux and Windows
  a webview without one is a text field where Ctrl-C does nothing. Every other
  item is navigation or a link. **External links leave the app:** a report is
  full of the audited site's own URLs, and following one used to replace the
  report with somebody else's website, in a window with no address bar to get
  out of.

  Packaged with a Node inside it: a 23 MB `setup.exe`, a 45 MB `.deb`, a 115 MB
  AppImage. Each platform builds on its own runner, then **installs what it
  built, runs it, and waits for the engine to appear** — because building a
  bundle only proves it bundles, and four separate bugs survived to that step.

- **The desktop shell knows when there is a new version, and offers the one
  thing that is safe.** The macOS app settled the principle — the thing that
  installed it is the thing that replaces it — and it generalises unevenly,
  because the platforms differ in what a program may do without a password it
  cannot ask for. A winget install runs `winget upgrade` in place and offers to
  relaunch; an apt install is shown the command, because `apt` needs root and a
  GUI app that shells out to `sudo` hangs on a prompt nobody can see; an
  AppImage, an installer copy or a hand-placed one gets the release page.

  It does not download a binary and put it in place itself. That needs a
  signature to check or a checksum to compare, and an updater that overwrites an
  application on the strength of a plain HTTPS response is a supply-chain hole
  with a progress bar on it.

  Once a day, on a thread, after the window is up, with **Check for Updates…**
  in the menu for asking anyway. It uses GitHub's API and falls back to the Atom
  feed, because the anonymous quota is sixty an hour per address and being
  refused is ordinary — and a version learned from the feed is announced with
  "whether it is a full release could not be checked" rather than asserted,
  which is the wording the macOS app already uses.

  Native dialogs, so the shell still owns no interface of its own. And no HTTP
  client crate: the Node it already ships has `fetch`, and adding a TLS stack so
  a 110 MB bundle can make one request a year is the larger thing.

- **Every report can be saved, from any browser.**
  `/reports/<id>/export?as=…` returns the file with a name that sorts, in all
  seven formats. Links rather than a native dialog: a browser downloads them and
  the desktop shell inherits the lot, so the feature landed once and every
  platform got it. The macOS app has had an Export menu since it shipped and the
  browser had none — somebody on Linux could read a report and not save one.

  The format list moved to `src/exports.mjs`. It was written out twice already,
  and a third copy would have been where they started disagreeing about whether
  "Structured data" is called that.

- **A tagged release carries the Windows and Linux bundles too.** Pushing a
  version tag already ran three workflows; this is the fourth, and it attaches
  the `setup.exe`, the `.deb` and the AppImage beside the macOS zip. It builds
  them the same way a branch push does — including installing what it built and
  waiting for the engine — so the file on a release page is one that was proven
  to start, not one that was proven to compile.

  It never creates the release, only waits for it. The macOS job writes the
  title from the tag's annotation and the notes from the CHANGELOG section, and
  a job racing it to create an empty one would win about half the time and take
  both away. Waiting is the whole of the coordination between them.

  A **winget manifest** goes with it, which is what makes the Windows half of
  the updater reachable at all: `winget upgrade` can only move a copy winget
  installed. Submitting one opens a pull request against `microsoft/winget-pkgs`
  and so needs a token this repository does not have — so the job says out loud
  that it was skipped, because a release that quietly did not publish looks
  exactly like one that did.

- **Two things that were written down twice are now checked.** The version
  lives in four files, and the shell refuses to start when its version and the
  engine's disagree — so a half-finished bump would have produced bundles that
  cannot run, discovered after the tag was pushed. And the winget identifier
  lives in the workflow that publishes it and the Rust that queries it; winget
  answers a name it has never heard of with silence, so that drift would have
  shipped as a Windows build that simply never finds an update. Neither had a
  symptom worth debugging. Both now fail on the machine of whoever caused them.

- **`npm run test:all` runs three suites**, adding `cargo test` over `desktop/`.
  Same rule as the others: a toolchain that is not there, or an engine not yet
  staged beside the shell, is reported as not run and never silently skipped.

- **`--serve` is the desktop UI for Linux and Windows.** It always was, in the
  sense that the macOS window is a thin client over exactly this server — but
  it printed a URL and offered a form with two inputs, so nobody read it that
  way and nobody could have.

  It now **opens a browser** when a person ran the command, and never when
  something else did. The same distinction the pipe check already made: the
  macOS window spawns this and draws its own report, and would otherwise get a
  browser it never asked for on every launch. `--no-open` is for the person who
  wants neither. Three platforms, nine lines, no dependency — and failing to
  open one is not a reason to refuse to serve, so the URL is printed either way.

- **Every setting the command line takes is in the form.** It offered `url` and
  `limit` while the engine took a dozen parameters, so somebody at a browser
  reached a sixth of what somebody at a terminal did — and `/run` forwarded only
  those two, which meant a control somebody set could quietly do nothing.

  The controls are drawn from `src/options.mjs`, the one table that already
  knows every flag and whether a window can reach it. Adding a flag with a
  `field` now adds the control; a flag without one is simply not offered, which
  is a decision written down beside the flag it is about. PageSpeed and Search
  Console are drawn only where the deployment has said those credentials are
  the visitor's own to spend, so a public Worker still offers neither.

- **A Preview button beside Audit.** `/preview` has answered clients since it
  shipped and no page ever reached it. A preview nobody can reach is a preview
  nobody uses, and the whole point of one is being reachable before the minutes
  are spent.

- **Finished runs are kept, and the browser can compare two.** The macOS window
  has kept every run since 1.23.0 and `--serve` kept none, so somebody on Linux
  or Windows got one report and lost it the moment they audited something else.
  A seven-minute crawl should only ever happen once, and that is not a
  macOS-only claim.

  `/reports` lists them, `/reports/<id>` reopens one as the same report every
  other front end draws, and ticking two runs compares them through the same
  `diff()` the CLI's `--baseline` uses — including the cross-site path matching,
  so a rebuild can be compared with the site it replaces.

  On macOS it writes **the folder the app already uses**, so a crawl started in
  the window is in the browser's list a second later and the other way round:
  nothing is synchronised, exported or copied, because there is one folder.
  Elsewhere it is `%APPDATA%` and `$XDG_DATA_HOME`, which is where those systems
  keep documents an application manages.

  A deployed Worker has no library at all. `worker/index.mjs` must stay
  web-standard — Cloudflare has no filesystem — so the local server hands it a
  store and a Worker is handed nothing, which is also the right answer for a
  shared host: keeping strangers' crawls is a thing nobody asked for.

- **The app updates itself, rather than explaining how to.** Pressing Update
  opened Terminal and pasted `brew upgrade --cask seo-audit` into it, which is a
  tool telling somebody how to update it. It now runs Homebrew in the window,
  streams what Homebrew says line by line, and offers **Relaunch** when it is
  done.

  Homebrew still does the part that matters — it verifies the download against
  the checksum the build wrote, and it keeps its own records straight, which is
  exactly why this app must not replace its own bundle behind its back. What
  changed is where it runs. No `sudo`: the cask installs into `/Applications`
  and clears the quarantine flag without one, so nothing can sit waiting for a
  password nobody can type. Terminal and Copy are still there for anyone who
  would rather watch it happen.

  Verified by downgrading a real install to 1.33.1 and pressing the button.

### Fixed
- **The first desktop bundle opened, started nothing, and waited.** It staged
  `bin` and `src` and not `worker`, which `--serve` imports, so it spawned its
  engine and waited fifteen seconds for an address that was never coming. The
  staging script now **starts what it staged and waits for it to announce a
  port** — a list of directories is exactly the kind of thing that looks right
  and is not. Verified by removing `worker` again and watching it fail.

- **The Windows build installed, started, and refused its own engine.**
  `resource_dir()` returns a Windows *verbatim* path — the `\\?\` form that
  lifts the 260-character limit. Rust is happy with it and Node is not: the
  script runs, but `import.meta.url` comes out malformed and anything resolving
  a sibling file fails. `--version` reads `../package.json`, so it answered
  nothing, and the shell concluded its engine was broken. On that evidence it
  was right to.

- **The engine outlived the app when the app was killed rather than closed.**
  Closing fires `Destroyed` and quitting fires `Exit`; nothing fires when a
  process is terminated outright, and a 110 MB engine then sat holding its port.
  A job object with `KILL_ON_JOB_CLOSE` moves that promise from this code to the
  kernel. Linux passed the same test only because SIGTERM lets Tauri run `Exit`
  — the guarantee was missing on both and visible on one.

- **A windowed app had nowhere to say what went wrong.** Built with
  `windows_subsystem = "windows"` it has no console and no stdout, so a failure
  is a sentence in a window and nothing else — fine for a person, useless for
  the job that just installed it. `SEO_AUDIT_SHELL_LOG` now names a file the
  startup path narrates itself into, and both Windows bugs above were found by
  reading it.

- **A run started from the browser could not save three of its seven formats.**
  The sitemap, the `llms.txt` and the structured data are built during the crawl
  from data that is gone by the time the report arrives, and the served form
  never asked for them — so those links were permanently refused for every Linux
  and Windows user, while the macOS window has always asked. Found by clicking
  them.

- **The category guard read the export list as seven checks** needing categories,
  because it matched every `id:` in `src/`. It now asks
  `scripts/check-levels.mjs`, which only counts an id carrying a level — a
  scanner that can tell a finding from a file format.

- **The update banner never appeared on a machine whose GitHub quota was
  spent.** The anonymous API allows sixty calls an hour **per address**, shared
  with every other tool on the machine, so exhausting it is ordinary — this one
  was at 0 of 60. The app falls back to the Atom feed there, and a feed release
  is never allowed to announce an update, because the feed cannot tell a
  prerelease from a release.

  So it said nothing at all. No banner reads exactly like "you are up to date",
  which is the failure this project's entire report format exists to avoid,
  applied to itself. A newer version found only in the feed is now announced as
  what it is: *"Version 1.34.0 appeared — GitHub's API was out of quota, so
  whether this is a full release could not be checked."* The person decides.

- **Downgrade offered a command that has never worked.** There is one cask and
  it tracks the latest version, so `brew install --cask seo-audit@1.33.1` was
  offered for older releases and answered *"Error: No casks found"*. Found by
  pressing it. Homebrew can move forward and not back, so an older release now
  offers its zip, which works for any version.

- **A perfect score read as "0 points across 0 checks"**, which is arithmetic
  rather than a sentence. It now says nothing took points off.

## [1.34.0] — 2026-08-29

### Added
- **A score out of 100, and the checks that passed to earn it.** Every report
  now opens with a number, a grade and a ring: `81/100 (B)`, followed by the
  arithmetic that produced it. A run starts at 100 and pays for what is wrong
  with it — an error-level check costs 12 points, a warning 4, spread across
  the pages it is on — so what a check costs is exactly what fixing it is
  worth, and every piece of work in *Start here* now carries the points it
  returns.

  This project has refused a score everywhere else and the refusal still
  stands for the thing people usually mean by one: nothing here predicts a
  ranking, estimates traffic, or grades a site against its competitors. The
  weights are not a new judgement either — every check already carries a level,
  argued over check by check when it was written, and `scripts/check-levels.mjs`
  reads those levels back out of the source so a check promoted from warning to
  error cannot keep its old weight. A test asserts it on the machine of whoever
  changes one.

- **What passed, and what was never checked.** A report that only lists faults
  gives no way to tell a check that passed from one that never ran, and a
  missing finding reads exactly like a passing one. Both are now named: a
  **Passing** section listing every check the site cleared, in its own words
  (*"Every page has an og:image"*, not `og-image-missing`), and a **Not checked**
  section saying why the rest did not apply — no page carries an image, no
  redirect map was given, PageSpeed was not asked.

  A check that could not run is left out of the score entirely rather than
  counted as passed. A site with no images has not passed the alt-text check,
  and scoring it as though it had would hand out points for doing less.

- **Errors and warnings first, notes after them.** Findings used to arrive
  interleaved, and a note is *"worth knowing, may be deliberate"* — reading
  forty of them mixed into the faults is how a reader loses track of which is
  which. The terminal, the Markdown and the HTML now put what is wrong first
  and everything only worth knowing under its own heading, which says out loud
  that none of it costs the score anything.

- **`--write-schema <file>`** — the JSON-LD this site could add: `WebSite`,
  `Organization` and `BreadcrumbList`. Every schema generator on the internet
  asks you to type the answers in; this one refuses to ask, because the moment
  it asks it is no longer describing the site — and structured data that
  describes a site inaccurately is worse than none. It is a machine-readable
  claim the page does not support, which is a manual-action category at Google.

  So the rule is narrower than the rest of this project's and it is absolute:
  every value emitted is a string this crawl read off this site. An
  organisation is named only when the site names itself in `og:site_name`,
  because the home page's title with its tagline still attached is a claim
  about a company's name.

  The first live run made the point better than any test: a breadcrumb built
  from `<title>` produced *"Assets | Jekyll • Simple, blog-aware, static
  sites"* as a step. A title is not a breadcrumb name. Now a step is named by
  the page's `<h1>` when it has exactly one, or by what the site's own
  navigation calls it when the links agree and the words are not "read more" —
  and by nothing else. `Jekyll › Docs › Assets`. On that site 142 pages were
  skipped rather than given a name invented from a slug.

  The refusal can be the good answer here, so it says which it is: a site that
  already declares everything this could write gets told exactly that, with the
  counts, rather than the same sentence a site with no evidence gets.

- **`--write-llms <file>`** — the `llms.txt` this site should have had.
  Sibling to `--write-sitemap`, on the same premise: the crawl has already read
  every page's title, description, section and indexing directives, which is
  exactly what the file is made of. Every line is a string the site already
  serves — a page that gave us no description gets a line without one rather
  than a sentence somebody made up about it, and the H1 is the site's own name
  for itself rather than a guess.

  It refuses for the same reasons the sitemap does, and the refusals matter
  more than the file: this is a document handed to an assistant as the
  authoritative summary of a site, and one built from a third of the site is
  worse than none because it looks complete. A truncated crawl writes nothing
  and names the run that would work.

  Reachable everywhere: the flag, `llms-out=1` on the Worker, the macOS Export
  menu (which says *why* when the engine refused), the Raycast extension, and
  a `write-llms` input on the Action. `--write-sitemap` gained the Action input
  it should always have had while the wiring was open.

- **Search Console now answers where you rank, and what for.** The same
  connection, asked one more question — no second account, no scrape, no
  keyword provider, and no number that anybody here worked out.

  Every response Google has ever sent carried `position`, and it was being
  thrown away. It now travels with each finding, so a template on page two can
  be ordered ahead of one nobody has been shown, and the scope line says *"12
  pages, 4,300 impressions, best at position 6.4"*.

  **`search-console-striking`** names the crawled pages at positions 11 to 20 —
  page two, where the click-through rate is roughly nothing and the ranking is
  already earned — with the query each is closest on, most-shown first. It is
  the only list in this tool that is an opportunity rather than a fault, and
  moving one of them up two places is usually less work than a new page.

  A live property found the part no test would have: Google returns HTTP 200
  and **zero** query rows for a site under its anonymity threshold — 99
  impressions over 28 days was well under. Silence there reads exactly like
  "this site is found for nothing", so the report says which it is. The query
  call is best-effort besides: if it fails, the positions still stand.

- **Which AI crawlers a site lets in.** GPTBot, OAI-SearchBot, ClaudeBot,
  Claude-SearchBot, PerplexityBot, Google-Extended, Applebot-Extended, CCBot
  and five more, asked of `robots.txt` through the same `robotsVerdict()` every
  other robots question in this project goes through — so a rule this reads and
  a rule Google reads are the same rule, longer-`Allow`-wins included. Nothing
  is fetched that was not already being fetched and nothing is estimated: a
  site's position on being read by the answer engines is already written down
  in a file it already serves.

  It is a **note**, and stays one. A publisher who does not want their work in a
  training set and says so has done the correct thing correctly, and a check
  that cries wolf gets the whole report ignored. What the finding adds is the
  distinction everybody gets wrong — an *answering* crawler fetches a page
  because somebody asked a question just now, so blocking it removes the site
  from that answer today; a *training* crawler does not, and blocking it changes
  nothing about being cited. And it says whether anybody actually decided: a
  block that arrives through `User-agent: *` rather than the agent's own name is
  usually a CDN or plugin default nobody has seen.

  The one thing here that is a fault gets a warning: `ai-crawler-conflict`, a
  site serving `llms.txt` — a file whose only purpose is to tell an assistant
  what to read — while `robots.txt` turns that assistant away. The invitation
  never gets read, and unlike the block itself, nobody chose it.

  New area, **AI & answer engines**, which `llms-missing` moves into: it is
  addressed to assistants rather than to crawlers and belongs beside the agents
  that read it.

- **`/checks`**, served beside `/options`: every scored check with its weight,
  its area and what it says when it passes. "What does this thing actually
  check" is now a question with a fetchable answer rather than one that needs a
  source file read.

### Changed
- **The CSV is the whole checklist, not only the faults.** A `points` column
  carries what each failing check is taking off the score, so a spreadsheet
  sorts by what fixing something is worth rather than only by how often it
  occurs. Checks that passed arrive as rows at level `pass`, and ones that did
  not apply as `not-checked` with the reason in `detail`.

  Additive on purpose: `points` is appended after `detail` rather than put
  beside `indexable` where it reads better, so every column keeps the index it
  has had since the file shipped. Anything filtering on `error`, `warn` or
  `info` is untouched.

- **The portfolio table has a score column**, and orders by it where every run
  has one. "Which of my twenty sites is worst" is the only question a portfolio
  exists to answer, and counting errors weighs a site-wide failure the same as a
  warning on one page of four hundred. A run that never answered prints a dash,
  never a zero.

### Fixed
- **`<title>` and every heading arrived with their HTML entities undecoded.**
  `attr()` has decoded since it was written, so meta descriptions were always
  fine — but a title and an `<h1>` are element text and went through none of
  it. So `Widgets &amp; Co` was the title in the terminal, in the CSV, in the
  JSON, and in the length `title-long` measures against what Google shows,
  where it was five characters too long. Hexadecimal numeric references were
  not handled at all, and `&#x2019;` is what a CMS emits for the apostrophe in
  *Widget's*.

  Found by generating an `llms.txt` for a real site and reading the first line
  of it — not by the test suite, which is the usual way round here.

- **Every export dropped the score except the two that were written first.**
  It reached the terminal and the HTML and stopped there: the CSV had no column
  for it, the portfolio had no column for it, the Raycast extension's exports
  did not pass it to the writers, and the PDF the macOS app draws itself did not
  know about it.

  Worst of the four: the window re-encoded the report from its own Swift models
  on the way to `/render`, which silently dropped every field it had not been
  taught about — so an HTML report exported from the window lost the score panel
  the window itself was showing. The JSON export has written the engine's bytes
  verbatim since it shipped, with a comment saying exactly why; the other three
  formats now do the same. There is a test per writer.

- **`--against` never ignored hosts, though it said it did.** Comparing a
  rebuild against the site it replaces is the same question as comparing
  yesterday against today — *did this change anything* — but `diff()` keys a
  finding on its whole URL, and every URL on `new.example.com` differs from its
  twin on `example.com` by the host. The flag has passed `{ ignoreHost: true }`
  since it shipped and `diff()` has never read a third argument, so the answer
  came back with every finding fixed and every finding added at once, which is
  no answer at all.

  Two runs of different origins are now matched by path — trailing slash
  ignored, query kept, since `/search?q=a` and `/search?q=b` are two pages on
  any host. It decides for itself when it is not told, so the hosted `/diff`
  and the macOS window get it without either having to know the rule.

- **The macOS window could only compare two runs of the same site.** Its
  Compare menu filtered the library by host, so a rebuild kept beside the site
  it replaces greyed the button out — the exact comparison somebody keeps two
  reports around to make. Runs of other sites are now offered under their own
  heading, and the sheet says it matched by path when the hosts differ.

## [1.33.1] — 2026-08-24

### Fixed
- **The macOS app skipped the certificate checks and blamed the hosted
  version.** `worker/index.mjs` runs in two places — Cloudflare, which has no
  socket to read a certificate over, and `--serve` under Node, which does — and
  it switched the check off for both. The window talks to `--serve`, so every
  report it produced was missing `tls-expiring` and `tls-expired`, above a note
  reading *"This report was produced by the hosted version"*. It was not.

  Two failures in one: a check quietly not run, which reads exactly like a check
  that passed, and a note naming a runtime that was not involved. `--serve` now
  declares that it can read certificates and gets the real check; a deployed
  Worker leaves it unset and keeps the note it has always deserved.

## [1.33.0] — 2026-08-24

### Added
- **The app tells you an update exists, and offers to fetch it.** It knew
  before — `checkIfDue()` has had a one-a-day guard for versions — but it was
  only called from the main view's `.task`, which runs once when the window
  appears. An app left open for a week checked once, in that week's first
  minute, and a release cut the next morning went unmentioned until somebody
  quit and came back. And when it did know, the only place that said so was a
  Settings pane somebody had to think to open.

  Now an hourly timer and `didBecomeActive` both funnel through the same
  day-old guard — the timer for an app left running, becoming active for the
  laptop that was shut overnight, since a timer neither fires while asleep nor
  keeps its schedule afterwards.

  A banner sits above the report rather than in front of it: a new version is
  worth mentioning and never worth interrupting a crawl for. Dismissing it
  dismisses that version for good, because a bar that returns every launch is a
  bar people learn to ignore.

  Downloading shows a real fraction where GitHub sent a length and an
  indeterminate spinner where it did not — a bar that sits at zero and jumps to
  full is worse than one that admits it cannot say. It unpacks with `ditto`,
  which is what wrote the archive and what keeps the bundle's signature intact.

  **It stops at the drag, deliberately.** Replacing a running bundle safely
  needs a helper process that outlives the app it is overwriting, which is
  Sparkle's whole job; and a Homebrew install has one correct answer that is not
  this one, since overwriting the bundle behind `brew`'s back leaves its records
  describing a version that is no longer there. So a cask install gets the
  `brew` command run in Terminal where it can be watched, and everything else
  gets the file revealed in Finder.

- **A Search Console pane in the macOS app**, and the whole Help row is now the
  click target rather than its chevron. `DisclosureGroup` only hit-tests its own
  triangle, which left a full-width row that looked clickable everywhere and
  answered in one corner — that reads as the app being broken, not as a small
  control.

  The pane takes the property and offers a sign-in, which runs the engine's own
  `--search-console-login` through the bundled Node. The token never passes
  through the app and is never displayed: a token on screen is a token in a
  screenshot. What comes back is the list of properties the account can read,
  each with a button to use it, because a token that can read nothing looks
  exactly like one that works until a run says the property was not found.

  The hosted Worker will **not** honour `?search-console=` unless the runtime
  sets `ALLOW_SEARCH_CONSOLE`, and `--serve` sets it only because it binds to
  the loopback address. The credentials belong to whoever started the server, so
  a deployed Worker accepting a property name would hand a stranger somebody
  else's traffic data. Gated, shape-checked, and tested.

- **A Help pane in the macOS app.** Written as the questions the app actually
  raises — why a crawl takes minutes, why the page count differs from the
  sitemap's, where the score is, why performance is blank until it is switched
  on, what leaves the machine — rather than a tour of the controls. A control
  that needs explaining is better renamed; a *decision* is what needs saying,
  and this app makes several that surprise people.

  Folded away rather than expanded: a wall of prose in a settings window is a
  wall nobody reads, and a list of questions is scannable.

- **`--search-console-login`.** The three Search Console credentials were
  documented for a year and there was never a way to obtain the third, which is
  the actual reason `--search-console` had never run against the live API: not
  the code, the paperwork in front of it.

  Loopback OAuth, which is what Google calls the installed-app flow — a desktop
  client may redirect to any port on 127.0.0.1 without registering it, so this
  listens on an ephemeral one and the browser does the signing in. Read-only
  scope. The refresh token is written to `~/.config/seo-audit/.env` at mode
  `600` and never printed, because a token echoed to a terminal is a token in a
  scrollback buffer. It rewrites that one line and leaves the PageSpeed key
  alone, which is tested, because clobbering somebody's key to save a token
  would be a poor trade.

  Then it lists the properties the account can read. A token that can read
  nothing looks exactly like one that works, right up until an audit says the
  property was not found.

  Not a GitHub Action input, deliberately: it opens a browser, and a flag CI
  can accept and never satisfy is worse than no flag. `src/options.mjs` records
  the same answer for the macOS window.

  The parts that can be wrong quietly are separate exported functions with
  tests — the authorisation URL, the token exchange, the file rewrite — and the
  loopback flow itself is exercised end to end with only Google faked,
  including that a reply carrying the wrong `state` is refused and writes
  nothing.

### Fixed
- **Search Console could never read its credentials from the dotfile.** It had
  its own copy of the loader that `psi.mjs` uses, and its copy built the pattern
  with `new RegExp` and a template literal, where `\\s` survives as an escaped
  backslash rather than as whitespace. The regex compiled to
  `/^\\s*GSC_CLIENT_ID\\s*=.../m` — a literal backslash followed by `s` — so it
  could not match a line of a real `.env`. It never threw. Only environment
  variables ever worked.

  Nothing caught it because the only tests for that path injected credentials
  and used a fake API, which is exactly what "never run against the live API"
  hides. There is now one loader in `config.mjs` that both callers use, and it
  is tested against a dotfile with the whitespace a hand-edited file actually
  has — including a name that is a prefix of another, which the broken pattern
  would also have got wrong.

## [1.32.0] — 2026-08-24

### Added
- **`twitter-image-broken` — a declared `twitter:image` that does not load.**
  The absence of a Twitter card stays unreported and always will: X falls back
  to Open Graph correctly, so reporting it would invent a defect. This is the
  opposite case, and the roadmap's rejection of the first did not cover it —
  nothing falls back to anything when the tag is present and 404s, and the one
  platform handed its own tag previews blank.

  Only when it differs from `og:image`, so one picture never produces two
  findings, and only on 404/410/no-answer, because a 403 is hotlink protection
  working. All four silent cases are tested: same picture, no tag at all, a
  403, and a redirect to the real file.

- **`body-not-html` — a URL the server calls HTML that is not HTML.** The body
  is already read, so it costs no request, and it replaces the checks it
  silences rather than joining them. A real site serves an XML document at
  `/locations.kml` with `Content-Type: text/html`; the crawl believed the header
  and reported thirteen things — no title, no h1, no viewport, no charset, thin
  content, three Open Graph tags — every one of them true about a document that
  was never a page, and not one of them the thing to fix. Now it is one finding
  saying what is actually wrong, and the reason it matters: Google indexes
  whatever comes back under `text/html`.

  It answers on positive evidence only. XHTML opens with an XML prologue and is
  HTML; a fragment with no `<html>` wrapper is HTML; a byte-order mark before
  the doctype is HTML; something merely starting with a brace is not JSON. All
  four are tested, because guessing wrong here would silence every check on a
  real page — a far worse failure than the noise it removes.

### Fixed
- **A dead site with an expired certificate is told what is actually wrong.**
  `expired.badssl.com` came back as *"The site did not answer a single request …
  The TLS connection succeeds but no response arrives … Cloudflare Bot Fight
  Mode does exactly this."* Both halves were wrong: the TLS connection does not
  succeed, and the cause is a certificate that ran out in 2015. The site checks
  that would have named it never run, because the crawl gives up first — and a
  browser refuses an expired certificate exactly as `fetch` does, so from the
  crawl's side "nothing answered" and "the certificate lapsed" are the same
  silence.

  The certificate is now read before bot protection is blamed, over the same
  non-validating socket the check already used, and the report says
  *"The TLS certificate expired 4151 day(s) ago … which is why nothing here
  could be fetched."* Found by asking whether the Raycast extension really gets
  the certificate checks: it does, and this hole was underneath the question.

  Where the certificate cannot be read at all — the hosted Worker has no socket
  — the old wording stands unchanged, minus the sentence claiming the
  certificate is fine. A runtime that cannot run a check says so rather than
  implying a result.

- **One row named one Open Graph tag and counted three.** A run against a real
  site printed `Missing og:description ×6` over four pages — three of which were
  missing only the description, one missing all three tags — and listed that one
  page three times. Every finding under it was true. The sentence above them was
  not, and a summary that misreports is the thing grouping exists to prevent.

  The cause: `og:title`, `og:description` and `og:image` were pushed under one
  id, and a group takes its title from the finding it saw first. They are now
  `og-title-missing`, `og-description-missing` and `og-image-missing` — three
  ids, because they are three different repairs. A missing `og:image` is a
  picture somebody has to make; a missing `og:title` is one line of template.
  Splitting them also makes each separately ignorable, so a site that ships no
  `og:image` on purpose can silence that without silencing the other two.

  `--ignore og-missing` keeps working and still silences all three. Splitting a
  check is our decision, not the decision of whoever wrote that config, and an
  upgrade that promises to be compatible should not start failing their build.

  Not generalised, and the reason is worth writing down: four other ids also
  carry more than one title — `img-alt-long`, `img-dimensions`, `heading-skip`,
  `anchor-ambiguous` — and all four are correct. They are the same problem with
  the page's own numbers in the title. A test asserting one id, one title would
  have flagged the four right ones and this was the only wrong one.

- **A Raycast preference could do nothing and nobody would know.** The
  extension's hand-written `Preferences` type listed three of the thirteen
  preferences `crawlOptions()` actually reads; the other ten were invisible to
  every caller. It is now `ExtensionPreferences`, which the Raycast build
  generates from the manifest, so it cannot disagree with what the manifest
  says — and the two components that read preferences had been calling
  `getPreferenceValues()` untyped, which is what the change surfaced
  immediately. `Arguments.Audit` replaces a second hand-copied shape.

  Types only cover half of it: `present.mjs` is plain ESM so `node --test` can
  run it, so a test now checks in both directions that every preference the
  manifest declares is read and that nothing reads a preference the manifest
  does not declare. A setting that quietly does nothing is the same failure
  `src/options.mjs` exists to prevent for the macOS window.

  Found by Greptile on the Store submission, which is worth recording: it
  called the type duplication a maintainability nit, and the count made it a
  defect.
- **A release no longer starts by failing.** The macOS job builds on a tag and
  attaches the app to that tag's release — a release the documented procedure
  created afterwards, by hand. So every release began the same way: a red
  `release not found`, a `gh release create`, a re-run. A failure that is part
  of the normal procedure is a failure nobody reads, and the next one, which is
  real, reads exactly the same.

  It now creates the release when it is missing, titled from the tag's own
  annotation with that version's CHANGELOG section as the notes — both already
  written by the time a tag is pushed, so neither becomes a second copy to keep
  in step. A tag with no CHANGELOG section gets a warning and generated notes
  rather than a lost build, because by then the app is already sitting there
  signed.

  The section is found with `index()` rather than a regex, which is the bug that
  was there to be written: `## [1.31.0]` interpolated into a pattern makes
  `[1.31.0]` a character class matching the digits `0`, `1` and `3`. It would
  not have errored. It would have published the wrong section, or none.

### Changed
- **`npx @nurkamol/seo-audit` is the install the site and README lead with.**
  The repository form still works and is still documented, pinned — but it
  clones 16 MB of app sources, screenshots and tests to reach a 115 kB crawler,
  measured rather than guessed. `npm i -g` is written down too, for anyone who
  would rather type `seo-audit`.

## [1.31.0] — 2026-08-24

### Added
- **The engine is published to npm as `@nurkamol/seo-audit`.** Not for its own
  sake: a Raycast Store submission is the extension folder and nothing above it,
  so `lib/engine.ts` importing `../../src/audit.mjs` was a blocker — it built
  here only because the repository happened to be around it. Copying `src/` into
  the extension would also have built, and would have put a second copy of
  ninety checks in this repository, which is the thing every front end here
  refuses. So the five modules the front ends actually use get named `exports`,
  and the extension depends on the package like anybody else would.

  Scoped because npm refused the bare `seo-audit`: too similar to `seoaudit`,
  an abandoned 2019 package whose description is the words `#### Installation`.
  The scope is what npm itself suggests, and it matches how this project is
  already referenced everywhere else — the repository, the cask, and
  `uses: nurkamol/seo-audit@v1`. The installed binary is still `seo-audit`.

  `npx github:nurkamol/seo-audit` keeps working exactly as before, and there is
  still nothing to install and no build step. Releases publish from a tag with
  npm's trusted publishing, so no token is stored anywhere — the workflow proves
  its own identity to npm and the package carries a provenance attestation
  pointing back at the commit it was built from.

- **`scripts/link-engine.mjs`, run by `pretest`.** Inside this repository the
  package is not installed, so the extension's own imports had nothing to
  resolve to and both `ray build` and `node --test` failed on a fresh checkout.
  A symlink at `raycast/node_modules/seo-audit` pointing back at the repository
  fixes it with no network and no publish step, and `raycast/package.json` still
  says the version the Store needs to see. Wired to `pretest` rather than
  documented, because a setup step somebody can forget is a test suite that
  quietly stops covering a front end.

### Changed
- **The Raycast extension is ready to submit.** Five 2000×1250 screenshots
  captured from the running extension rather than mocked up, a README written
  as the Store page it becomes, and `publish` and `pull-contributions` in the
  documented `npx @raycast/api@latest` form rather than whichever `ray` version
  is installed locally. Proved rather than assumed: a copy of `raycast/` alone,
  with only its declared dependencies, builds.

- **The Raycast extension is checked against the Store guidelines.** Six things
  had to change. Commands may not contain articles, so *Preview a Site* and
  *Audit a Site* are **Preview Site** and **Audit Site**. Subtitles may not
  duplicate the title, and all three were the extension's own name, which
  Raycast already shows beside them — gone. The description had to be one
  sentence and was two. A root command may not set its own `navigationTitle`,
  and *Audit Site* did. Submenus take an ellipsis, so Export is **Export…**.
  And `platforms: ["macOS"]` was missing, which it is not: this reads the folder
  the macOS app writes.

  Two fixes were not from the guidelines but from reading the code beside them.
  *Open in SEO Audit* only launched the app — it cannot be told which report to
  show — so it says **Open the SEO Audit App**, because a control that
  overstates what it does is worse than one that does less. And a preview that
  said *"185 past the limit of 25"* offered no way to raise the limit; every
  command now has **Open Extension Preferences** on `⌘,`.

  `CHANGELOG.md` and `metadata/` exist for the Store. `raycast/README.md` lists
  what is still outstanding, including the one that blocks submission: the
  extension imports the engine from outside its own folder, and a Store
  submission contains that folder alone.

- **The app screenshot on the website is the app that exists.** It was twelve
  commits stale — 1.24.0, before the **Preview** button, the **Compare** menu,
  the sitemap export and the real logo, none of which a visitor could see. It is
  a 25-page run of jekyllrb.com now: 171 findings as 55 things to change, with
  the counts, the cause cards and both menus in frame.


## [1.30.0] — 2026-08-24

### Added
- **The Raycast extension reaches every flag that shapes a run, and writes every
  format the engine can.** It shipped in 1.29.0 sending three options of about
  twelve and offering no file export at all, while the engine sitting next to it
  had `html()`, `markdown()`, `csv()` and a sitemap rebuilder. That is a demo of
  a front end rather than one.

  Preferences now carry the **sitemap override**, **exclude patterns**,
  **`--since`**, the **browser and system menus**, a **user agent of your own**,
  **PageSpeed** with its sample and strategy, and the **silenced-check list**.
  Anything left at its default is left out rather than sent, so the engine's
  defaults stay written down in the engine — the same rule the macOS app's
  settings follow.

  **Export on `⌘E`** writes HTML, Markdown, CSV, JSON or the corrected sitemap
  to Downloads through the engine's own writers, so a file exported from a
  launcher and one written by `seo-audit --csv` are the same file. The run asks
  for the sitemap while it still can: rebuilding one needs the status, robots
  directive and canonical of every page, and none of that survives the crawl.
  When the engine refuses to build one — a crawl that did not see the whole
  site — the refusal is shown rather than a file that would delete pages from
  somebody's site.

  Checked against a real run rather than argued: six pages of jekyllrb.com, six
  findings silenced by the ignore preference, four formats written, and the
  sitemap refused with *"run again with `--limit 210`"* carried through intact.

  The browser and system menus are the second thing the extension duplicates —
  a dropdown in a static manifest cannot read `src/agents.mjs` at runtime — so
  they are generated from it and guarded by a test, like the three named speeds
  already were. `raycast/README.md` lists what is **not** reachable and why, the
  way `src/options.mjs` does for the window.

  `bin/`, `src/`, `action.yml`, `worker/` and `mac/` are byte for byte what
  1.29.0 shipped. Nothing reaches an npx or Homebrew user from this release.


## [1.29.0] — 2026-08-24

### Added

- **The commands on the website have a Copy button.** A command is there to be
  run, which means it is there to be copied, and the brew block is three lines
  nobody should be retyping. `innerText` rather than `textContent`, so those
  three arrive with their newlines instead of running together into something
  that is not a command. The button is added by script, so a page without
  JavaScript shows the command and no dead control; it appears on hover *and* on
  keyboard focus, because a control only a mouse can find is one some people do
  not have; and it stays visible on touch, which has no hover at all. If the
  clipboard refuses — an insecure context, or a browser that says no — it
  selects the command and says **Press ⌘C**, which is still the difference
  between one keystroke and retyping it.

  The example report output deliberately has no button. Nobody wants to copy
  that.

- **A Raycast extension**, in `raycast/`. Three commands — **Preview a Site**,
  **Audit a Site**, **Recent Reports** — and it re-implements nothing:
  `import { preview } from "../../src/audit.mjs"` is the same line
  `worker/index.mjs` uses, so a report from a launcher and one from
  `seo-audit --json` are the same report. Raycast runs Node, so unlike the
  hosted Worker it gets `node:tls` and the certificate checks work there.

  **Preview is the command it exists for.** A crawl takes minutes and a launcher
  is built for the second you spend in it — running a seven-minute job behind a
  keystroke is the obvious idea and the wrong one. Preview is the engine's
  `--dry-run`: three requests and about a second for how many URLs are listed,
  how many would be checked, and where the weight of the site is. Auditing is
  capped by preference at 25 pages, and a bigger site is pointed at the app or
  the terminal rather than left spinning.

  **Recent Reports reads the folder the macOS app writes**, so a crawl finished
  in the window is in the launcher a second later with nothing synchronised or
  exported. Read-only: deleting somebody's seven minutes behind a single Return
  is not a good trade, and the app has the confirmation.

  Everything that is not React lives in `raycast/lib/present.mjs` — plain ESM,
  no `@raycast/api` import in it — so `node --test` runs it. Ten tests, and one
  of them guards the single thing the extension duplicates: Swift's
  `CrawlSettings.Speed` and `SPEEDS` are the same three numbers in two
  languages, and two people reading "Gentle" should get the same crawl.

  `@raycast/api` is a dependency of that folder and nowhere else — the same
  arrangement `worker/` has with Wrangler. `raycast/` is absent from `files` in
  `package.json`, so the npx payload is still just the CLI.

  Two things running it found. A crawl showed a path and no horizon —
  "Reading /docs/plugins/" could be the second page or the last — so it counts
  now: **"12 of at most 25 pages"**. Bounded is the difference between slow and
  stuck, and slow is honest for a crawl. And a report kept before areas
  travelled with causes listed everything under **Other**, including
  `no-editorial-links`, which has been in Links the whole time; the area is
  asked of the engine when a stored file does not carry one.

  **It builds and lints.** `ray build` and `ray lint` both pass, which is more
  than could be said when it was written: the first build found seven type
  errors, a `require()` sitting inside a component in an ES module, and a type
  imported under the same name as a component declared beside it. The fix was
  `lib/engine.ts` — one place that says what the engine returns, rather than a
  cast at each call site where four components would each hold their own opinion
  and three would go out of date.

### Changed

- **The icon is the logo, not a drawing of it.** The one that shipped was
  redrawn from the reference rather than taken from it — flat instead of glossy,
  a different arrowhead, no dots on the trend line. Two reasons, and I gave the
  weaker one more room than it deserved: gloss is a 2010 idiom whose specular
  highlight is the first thing to go at 16 pixels, which is true and was not the
  main point. The main point was that the reference is stock art of unknown
  licence, and this repository is MIT and public. That is the owner's call to
  make, and it has been made.

  So the original is now the source: masked to the macOS squircle with the same
  path the app already shipped, so the corners outside it are transparent and
  nothing draws a white frame around it. It is the icon in the app, on the
  website, and in the Raycast extension — one logo in three places rather than
  a drawing in two and a photograph in none.

  **And it is drawn twice, at two sizes.** `.icns` carries different artwork
  per size and this now uses it: the logo itself at 64 pixels and up, and
  `docs/icon-small.svg` at 16 and 32 — the same shape and the same orange
  sampled from the logo, with the gloss removed, the strokes thickened and the
  trend line reduced from four points and three dots to a rise with an arrow on
  it. A four-point line inside a ten-pixel lens is a smudge. Apple ships
  per-size artwork for exactly this reason, and it is not a second mark: it is
  the same one with the parts that cannot be drawn at that size taken out.

  It costs something, and the number is worth stating: the `.icns` goes from
  **189 KB to 1.0 MB**, because a glossy gradient does not quantise the way a
  flat glyph does. In the bundled app that is nothing; in the `--no-node` build
  it is a third of 3.5 MB. And at 32 pixels the gloss and the thin trend line do
  soften — visibly, not theoretically.

### Fixed

- **`tls-not-checked` was in "Other".** It is the note the hosted Worker leaves
  where the certificate checks would have been, and `tls-expiring` and
  `tls-expired` are both under **Site & security**. It belongs beside them.

## [1.28.0] — 2026-08-24

### Added

- **Reports and Updates are settings now.** They were deliberately left out when
  Settings was built, on the grounds that the sidebar and the Versions sheet
  already answered them. With a sidebar of panes that reasoning stops holding —
  there is room, and "where do my reports live" is a settings question wherever
  else it gets answered. Reports says how many are kept and what they weigh,
  reveals the folder, and offers to delete them all. Updates shows the version,
  when it last checked, a way to check now, and a way to **stop checking
  automatically** — which is a real preference, because it is one request to
  GitHub about which software you run.

- **A kept report can be exported from the sidebar.** Right-click any stored run
  and every format is there — a report that has to be on screen before it can be
  saved is a report you reopen just to save it. It is read from disk, so the
  file written is the run that was right-clicked and not whatever happens to be
  in front of you.

- **A page in a report can be copied or opened.** Right-click any page under a
  finding.

- **Setting your own user agent greys out the browser and system menus** rather
  than silently overriding them. The engine has always ignored them when a
  custom string is set; the window showed all three as live.

### Changed

- **Settings is a sidebar of panes, the way macOS lays out System Settings.** It
  was one form, and seven sections had grown it to about two thousand points of
  height — the sitemap field was below the fold on any laptop. Everything was
  reachable and nothing was findable, and a scrollbar is a poor table of
  contents.

  Seven panes now, each one subject, with the coloured rounded-square icons the
  platform uses: **Crawl**, **Coverage**, **Identify as**, **Performance**,
  **Silenced**, **Reports**, **Updates**.

### Fixed

- **Two settings fields stopped looking like fields.** A `TextField` in a
  grouped `Form` draws as right-aligned grey text with no box — which is exactly
  how that same Form draws a read-only value. So "Sitemap · Found
  automatically" and "Or your own · A string of your own" read as facts rather
  than as empty inputs, and nobody would guess they could type there. Both carry
  `.textFieldStyle(.roundedBorder)` again, and a test fails on a settings text
  field that has no style.

- **A cause card showed one page's detail as though it were the group's.** It
  printed the first finding's line above the whole list, and details differ per
  page — so "267 chars (limit ~160)" appeared above a page that was 202
  characters long. The line is shown once only when every page in the group
  carries the same one; when they differ, each page now shows its own, which is
  what the HTML report and the PDF have always done.

- **The Settings window had a toolbar-height empty band and a button that
  should not exist.** The band was two stacked views each carrying their own
  insets; the header lives inside the Form now, so the platform's spacing is the
  only spacing. And `.toolbar(removing: .sidebarToggle)` was applied to the
  split view, where it does nothing — it belongs on the sidebar's own content.
  A Settings window has no business hiding the sidebar that is the only route to
  six of its seven panes.

- **Eight corner radii became four.** 6, 10, 12, 15, 16, 20, 26 and 28, across
  nine files. The pairs are the tell: nobody decides that a text field is 15 and
  the tally card beside it is 16, or that one glass container is 26 and its
  neighbour is 28. Each was chosen alone, months apart, and *almost* consistent
  reads worse than plainly inconsistent — the eye notices two points without
  being able to name them. `Radius.pill`, `.control`, `.card` and `.surface`
  now, with a test that fails on a raw number so a fifth needs an argument.

- **The pane header was centred while everything under it was not.** The icon
  and title lined up with nothing else in the window, and the first thing the
  eye does in a settings pane is run down the left edge. Icon beside the title,
  both on the left, aligned with every row below.

- **A timestamp truncated before the time it stated.** "Last checked" shared a
  row with the Check now button, so the button took the width and the date read
  "Aug 24, 2026 at 2:…". Separate rows.

## [1.27.0] — 2026-08-24

### Added
- **Silencing a check, from the window.** `--ignore` has been on the command
  line for a long time and there was no way to say "I can live with this" from a
  report. Right-click a finding and its check is left out of future runs on this
  machine; Settings lists what is silenced, to undo it. Silencing lives on the
  finding because that is where somebody is standing when they disagree with it
  — a list in Settings is where you go to undo this, not to do it.

  A report still says **how many findings were silenced**, in the same line as
  the counts. `meta.ignored` has been in the payload since long before this and
  the window never showed it, which meant a check somebody quietened read
  exactly like a check that passed.

  Per-machine on purpose: a decision a whole team should share belongs in the
  config file the repository commits, not in one person's preferences.

- **PageSpeed Insights, from the window.** Off, the home page, or a sample of up
  to ten pages, on mobile or desktop. Google measures it in a real browser over
  its own network, which is the only way this tool will ever show performance —
  it refuses to estimate it, and a plausible wrong number is worse than none.

  **This app never holds an API key.** A key is optional, and the engine looks
  for it in `PSI_API_KEY` and `~/.config/seo-audit/.env` — the same two places
  the command line looks — so a key already set is already working, and one that
  is not gets the anonymous quota and a note saying so. There was no reason to
  build credential storage for a credential that is optional and already has a
  home.

  It is gated on the engine side rather than the app side: `--serve` sets
  `ALLOW_PSI` because it is bound to the loopback address and the person running
  it is the person it serves. A deployed Worker leaves it unset, where a
  stranger passing `?psi=` would be spending somebody else's quota and somebody
  else's seconds.

## [1.26.0] — 2026-08-24

### Added
- **`--since <date>`.** A five-thousand-page site audited every week does not
  need five thousand requests — the sitemap already says which pages moved, and
  `lastmod` has been parsed since early on and read by one check. On
  jekyllrb.com, `--since 2026-06-01` crawled **98 pages instead of 210**.

  Two refusals, both from the same place: a `lastmod` nobody maintains is worse
  than none, because it looks like an answer. A sitemap with no `lastmod` at
  all, and one carrying a single build stamp on every URL, both make the filter
  meaningless — so it says so, checks everything, and says the report is
  complete. A URL with no `lastmod` is **kept**: not knowing when a page
  changed is not evidence that it did not.

- **`--exclude <glob>`.** There was no way to keep URLs out of a crawl at all —
  the config file has ignore rules for checks, not for URLs. Faceted search, tag
  archives and paginated listings dominate the crawl budget and the report on a
  real store. Repeatable, and it reuses the glob dialect `--psi` already uses,
  where `*` stops at a slash and `**` does not. What it skipped is **always
  reported**, because a crawl that quietly shrank is a report that reads as a
  clean bill of health for pages nobody looked at.

  Both are applied by `--dry-run` too, so a preview keeps describing the crawl
  that would actually happen.

- **The command line and the window are kept honest about each other.** The CLI
  grew to thirty-three flags and the window reached ten, and nothing anywhere
  said which of the other twenty-three were decisions and which were oversights.
  It was both, in different places, and there was no way to tell from outside —
  the same failure this project refuses in its reports, where a missing finding
  reads exactly like a passing one.

  `src/options.mjs` is now one table with an answer for every flag: `app: true`,
  or a sentence saying why the window does not reach it. `npm test` enforces it
  in four directions — a flag with no entry, an entry for a flag that no longer
  exists, an entry claiming the window sends a parameter it does not, and a
  parameter the window sends that no flag corresponds to. That last one is a
  setting that quietly does nothing, which is the worst of the four.

  The test reads the Swift source from Node, deliberately: a macOS-only CI job
  would fail hours later on somebody else's machine, and this fails on the
  machine of whoever adds the flag. It found `--ignore` undeclared on its first
  run. The table is served at `/options` as well, so "can the app do X" has a
  fetchable answer.

### Fixed
- **Three source files were binary files to git.** `src/config.mjs`,
  `src/baseline.mjs` and `src/dupes.mjs` each held a literal NUL byte — used as
  a glob placeholder and as a key separator. The *values* were right: a NUL
  cannot occur in a URL, which is what makes it a good separator. Writing it as
  a raw byte is what was wrong, because one control byte makes the whole file
  binary, and then `grep` skips it and `git diff` refuses to show it. That is
  how a glob matcher sat in `src/config.mjs` unnoticed while somebody went
  looking for one to write.

  All three are `\u0000` escapes now, with behaviour unchanged — the glob
  checked against seven patterns, the diff key against a round trip. A test
  walks every tracked source file and fails on any raw control byte, so this
  cannot come back quietly. Writing the commit message for the fix hit the same
  trap, which is about as good an argument for the test as there is.

## [1.25.0] — 2026-08-24

### Added

- **Pages that are the same page again.** Titles and descriptions have been
  compared since early on; the bodies never were, and that is the axis a hundred
  product pages differ on by one word — they compete with each other for one
  result and spend the crawl budget that would have gone to the pages that are
  actually different. It costs **no extra requests**: the text was already read
  and measured for `words` and then thrown away, and what is kept instead is a
  64-number MinHash sketch, a few hundred bytes a page. Banding the sketches
  means most pairs are never compared, so it stays linear rather than quadratic
  on a five-thousand-page site.

  Three narrowings, because this is exactly the shape of check that cries wolf.
  A page that says `noindex` is not in the index to be duplicated in. A page
  whose `rel=canonical` points at another page has already declared itself a
  copy — that is the fix, correctly applied, and reporting it would be reporting
  a solved problem. And a page with no `<main>` or `<article>` has no comparable
  text: without one, the text of a page is the whole document, navigation and
  footer included, and every page of a small site would look like a copy of
  every other. That last case is **counted and reported**, never passed over.

  Two real sites before shipping: on jekyllrb.com it found `/docs/conduct/` and
  `/docs/code_of_conduct/`, both 200, both with self-referencing canonicals, and
  their content regions identical — a true one, and the same pair `duplicate-title`
  had been pointing at without being able to prove why. On a 120-page store it
  found **nothing**, which is the half that matters.

- **Compare two runs of a site, in the window.** The app has kept every finished
  run since 1.23.0 and compared none of them, so it could not answer the
  question that makes somebody open a tool a second time: did the fix work. A
  **Compare** menu beside Export lists the other runs of the same site, newest
  first, and the sheet shows what **appeared**, what is **gone**, and how much
  did not move — grouped, so a regression across forty pages reads as one thing
  rather than forty rows.

  The comparing is not done in Swift. `diff()` has been in `src/baseline.mjs`
  since `--baseline` shipped, and the app posts both sets to a new `/diff`
  endpoint, so a comparison from this window and one from
  `seo-audit --baseline` are the same comparison. On the first audit of a site
  the menu is present and says there is nothing kept to compare against, rather
  than being missing.

- **`--write-sitemap`.** Every other output here describes a problem; this one
  is the fix. The crawl already knows every URL it read, what each answered,
  whether it says `noindex`, and where its canonical points — which is exactly
  what decides whether a URL belongs in a sitemap. It writes the file, carries
  `lastmod` forward from the old one rather than stamping today on every URL,
  and **adds the pages that are linked but were missing** — the link sweep has
  already established those answer 200 and are HTML.

  The refusals matter more than the file. A sitemap that quietly drops real
  pages is worse than one full of dead ones: the dead ones are a warning in
  Search Console, the missing ones are pages that stop being crawled. So it
  writes nothing at all when the crawl stopped at its limit, when pages went
  unread because of rate limiting, or when more pages are linked-but-missing
  than the report enumerates — and each refusal says which run would work
  (`Run again with --limit 210`).

  On jekyllrb.com it wrote 213 URLs, carried 202 `lastmod` values across, and
  added `/docs/templates/`, `/help/` and `/docs/home/` — all three 200, all
  three HTML, none of them in the site's own sitemap.

  The Mac app exports it too, as **Sitemap (XML)**. It is built by the engine
  and travels with the report, because rebuilding it needs per-page data the app
  is never sent. When the engine refuses, the menu item is disabled and shows
  the reason where its description would be, rather than being absent or writing
  a short file.

- **`--dry-run`, and Preview in the window.** A full crawl is minutes of waiting
  and several hundred requests to somebody else's server, and there was no way
  to find out it was pointed at the wrong site until it had finished. This
  settles the host, reads robots.txt and the sitemap, and stops: how many URLs
  are listed, how many the limit would check, how many it would cut, and where
  the weight of the site is. **Three requests and about a second** on a
  210-URL site.

  It describes the crawl that would actually happen rather than an ideal one.
  Robots rules are consulted only when there is no sitemap and links are being
  followed, so it does not claim otherwise; a site with no sitemap comes back
  saying a count is not knowable in advance rather than inventing one.

- **A user agent of your own, in the Mac app.** The browser and OS presets
  cover the common cases; this is for the agent a host is known to treat
  differently, or a name that makes your crawls identifiable in somebody's
  logs. It wins over the two menus rather than joining them, and it is bounded
  and stripped of control characters — it ends up in a request header, and a
  newline in it would end that header and start another.

### Fixed

- **`.build/` was in the repository.** 2,849 files and 177 MB of SwiftPM
  output, swept in by a `git add -A` when the Swift package was first built, and
  in every tag since 1.23.0. Repository size is the smaller half of it:
  `npx github:nurkamol/seo-audit` clones the default branch, so the headline way
  to run this has been pulling 177 MB of object files to run a command that is
  about a megabyte. The history is left alone deliberately — rewriting it would
  change the commit every published tag points at, to save a cost only a full
  clone pays.

## [1.24.1] — 2026-08-24

### Added
- **A way to start a second audit that people can find.** Once a report filled
  the window the only way back was a ghost `‹ New audit` button in the report's
  own header — and `⌘N` had been removed along with the document commands this
  app has no use for, so there was no menu item and no shortcut either. Somebody
  looking for it did not find it, which is the only evidence that matters. There
  is now a **+ New audit** button at the top of the sidebar, visible whatever is
  on screen, and `⌘N` and File ▸ New Audit both work. A crawl in progress is
  stopped rather than left running into a window no longer showing it.

- **The settings window and a real report are on the website.** The app's shot
  is now a 25-page audit of jekyllrb.com — 169 findings as 50 things to change —
  rather than an empty field, because what the app is for is the report.

### Fixed
- **The app kept its things in two folders.** The report library wrote to
  `~/Library/Application Support/seo-audit` and the version cache added in
  1.24.0 to `.../SEO Audit`, so one app had two homes and neither was obviously
  the real one. Both go through one `Support.directory()` now, named for the
  bundle id rather than the display name — the display name is for people, and
  it has already changed once.

- **Two rows in the new Settings read as the wrong thing.** The sitemap field's
  placeholder was written as the field's *title*, so "Found automatically"
  printed as a label beside an empty box — which reads as a setting that is
  switched on rather than as what happens when the field is left alone. And the
  page count sat against its row's title on the far left with the stepper arrows
  an inch away, so the number looked like part of the label instead of the value
  the arrows change. Found by looking at a screenshot of it, which is the only
  way this kind of thing is ever found.

## [1.24.0] — 2026-08-24

### Added

- **The Mac app has settings.** `⌘,`, and only the flags that change what a run
  *does* — where reports are kept and whether to check for updates are already
  answered by the sidebar and the Versions sheet. **Speed** is the one that
  earned it: gentle, normal or fast, one, six or twelve connections, named
  rather than numbered because "6" is not a thing anybody knows they want and
  "this site keeps refusing me" is. Gentle is what gets through a store
  answering 429, and until now that was reachable only from the command line.
  Also the default page limit, outbound link checking, a sitemap override, and
  the browser and OS presets — fetched from a new `/agents` endpoint rather than
  listed again in Swift, so adding a preset to `src/agents.mjs` adds it to the
  menu.

  Anything left at its default is not sent, so the engine's defaults stay
  written down in the engine. The sitemap override is validated against the host
  being audited, and the concurrency is clamped: on the hosted version those two
  parameters would otherwise decide how many connections a stranger's site
  receives and which machines it can be pointed at.

- **`--json` carries the grouping.** The Worker's `?format=json` sent `causes`
  and the CLI's `--json` did not, so a machine reading a report from the command
  line got a different document from one reading the hosted version — against
  the rule that says those two must never differ. Both now call one
  `causePayload()`, including the `scope` sentence, so there is no second
  phrasing of it to drift. `--json` also keeps `traffic` where Search Console
  was asked. A **baseline** deliberately carries neither: grouping and
  impressions move on their own, and a baseline whose git diff churns is one
  nobody reads.

  Each cause also carries its `area` — the same table the HTML report groups by,
  moved to `src/areas.mjs` so `report.mjs` and `causes.mjs` can both read it
  without importing each other. That is what lets the Mac app's PDF group like
  the HTML report without a second copy of the table in Swift.

- **The website and the README show what it looks like.** Three real captures,
  not mock-ups: the app's window with the glass on it, an HTML report of
  jekyllrb.com, and the first page of a PDF that came out of the app's export.
  Three hundred kilobytes for all of them.

### Fixed

- **An HTTP 429 is no longer read as "absent" or "dead".** Running the tool
  twice against one host is enough to trip a store's rate limit, and the second
  run reported *No sitemap found* about a site whose sitemap the first run had
  just read, plus three `host-variant-dead` warnings — one of them against the
  canonical host, which is the variant a crawl hammers hardest and so the one
  most likely to be refused. 429 means "ask later". A rate-limited sitemap probe
  is `sitemap-not-checked`, a rate-limited host variant is
  `host-variant-not-checked` at note level, and a run where nothing was read at
  all is `crawl-rate-limited` rather than `nothing-crawlable`. A 404 still
  produces every one of the original findings, which is the half that matters.
  robots.txt and llms.txt learned this in 1.15.0; these three had been missed.

- **The PDF export was a summary sheet on one enormous page.** It printed the
  cause titles and their scope lines and nothing else — no detail, no URLs, no
  areas — and `write` emitted a *single* PDF page as tall as the whole report,
  which looked fine on the two-finding site it was tried against and would have
  been one unreadable strip for anything real. It now carries what the HTML
  report carries: the meta line, the counts, the work grouped by the area that
  fixes it, and under each piece of work every page it affects with what was
  written about that page. Paginated into A4 by measuring each block and packing
  pages, so nothing is cut mid-sentence, and pages are numbered. Still drawn
  natively rather than by printing HTML — there is no web view in this app — but
  only *drawn*: the areas now arrive from the engine on every cause, so the
  grouping is the engine's, not a second copy of that table in Swift.

- **The Versions sheet no longer goes blank when GitHub says no.**
  `api.github.com` allows sixty anonymous requests an hour per address, shared
  with every other tool on the machine that talks to GitHub, so a 403 there is
  ordinary — and it left an error message sitting above an empty list with
  nothing to act on. The list is now kept in Application Support, so a sheet
  that has ever succeeded never opens empty again; a refused API call falls back
  to `releases.atom`, which is served by `github.com` and does not spend that
  quota; and if everything fails the sheet offers the releases page instead of a
  dead end. The feed cannot mark a prerelease, so anything read from it is shown
  but never used to announce an update, and the sheet says so rather than
  quietly knowing less. Parsed with `XMLParser` from Foundation — Atom is XML,
  and this project does not take dependencies.

- **The app icon had a white frame around it.** `docs/icon@1024.png` had been
  flattened onto white — `hasAlpha: no` — so the transparent margin the squircle
  sits in came out opaque, and macOS drew the icon as a white rounded square
  with the orange mark inside it. The build rasterises `docs/icon.svg` instead:
  `sips` reads SVG and keeps the alpha channel, it ships with macOS so this
  costs no dependency, and the flattened PNG is gone rather than left to go
  stale beside the drawing it was made from.

## [1.23.0] — 2026-08-23

### Added

- **`--csv`, and every format in the Mac app.** The findings as a spreadsheet:
  one row each, with the page, the section, whether it is indexable, how many
  links point at it, how far from the homepage, and impressions where Search
  Console has been asked. A flat table on purpose — the grouped view is what
  the report is for, this is for sorting 2,081 rows by impressions or handing a
  filtered slice to a developer. Written with a byte-order mark, which is the
  difference between Excel showing "Maison Éthérique" and "Maison Ã‰thÃ©rique".

  The app exports **PDF, HTML, Markdown, CSV and JSON**, and owns none of those
  formats: it holds the findings it was streamed and posts them back to the
  engine's new `/render` endpoint, which runs the same writers the CLI uses. A
  report exported from the app and one written by `seo-audit --csv` are the
  same file. PDF is the exception, because it is a drawing of what is on screen
  rather than a format the engine has. JSON is written exactly as it arrived,
  so a re-encode cannot quietly drop a field the app's models do not know yet.

- **A website, and Help inside the app.** <https://nurkamol.github.io/seo-audit/>
  is built from `docs/`. The app's Help menu, its sidebar and a proper About
  sheet all point at it, so the answer to "what is this" is one click away
  rather than a search.

- **Reports are kept.** A 325-page site takes seven minutes to crawl, and
  losing that because a window was closed is the difference between a tool
  somebody opens twice and one they open once. Every finished run is written to
  Application Support as the exact JSON the engine produced — not the app's idea
  of it — so a report saved by one version still opens in the next, and `jq`
  works on it. The sidebar lists them with the date and what they found; a
  click reopens one instantly.

- **The Mac app has tests.** Thirteen, over the models, the URL normalising,
  version ordering and the library, run by `swift test`. The important one
  decodes a **real engine payload** captured from a live run, because the way
  this app breaks is the engine changing its output and nothing noticing until
  somebody opens a window. The views are deliberately untested: a snapshot of a
  glass card asserts what the design happens to be today and fails every time
  it improves.

- **CI builds the app on every change.** Until now Swift was only compiled when
  a tag was pushed, so a break landed on `main` and waited for release day.
  `mac-app.yml` runs the tests, builds the bundle and then captures a fresh
  engine payload and checks the app still decodes every field it needs — drift
  fails in CI rather than in a window.

### Changed

- **The app is called SEO Audit.** The command line stays `seo-audit`, the
  bundle id stays `com.nurkamol.seo-audit` and the cask token stays
  `seo-audit`: a display name is for people, those three are for machines.

- **A new icon.** The old one was the sitemap mark from the logo, which is
  accurate and abstract. This is a magnifier over a rising line — what the tool
  looks for, and what finding it is for. Drawn flat on the macOS squircle
  rather than the glossy bevel that style implies, because gloss is a 2010 idiom
  and the specular highlight is the first thing to disappear at 16 pixels.

- **The icons weigh a tenth of what they did.** `docs/icon.png` was 697 KB of
  unoptimised PNG for a flat glyph, used at 96px on a web page; it is 24 KB at
  512px now, the website uses the 1.5 KB SVG instead, and the app's `.icns` went
  from 1.1 MB to 189 KB. `build.sh` shrinks the iconset when `pngquant` is
  installed and skips it when not, because a build that needs a package manager
  to produce an icon is not a build anyone can run.

### Fixed

- **`brew trust` is in the install instructions.** Homebrew 6 refuses to load a
  cask from a tap nobody has vouched for, and the warning it prints when you
  skip it is easy to scroll past. Found by tapping the repository and
  installing from it, which also turned up `depends_on macos: ">= :tahoe"`
  being the deprecated spelling of `depends_on macos: :tahoe`.

- **`--serve` no longer exits the moment it starts under a redirected stdin.**
  It shuts down when its stdin closes, so that closing the app's window also
  takes the engine away. The check asked whether stdin was a terminal, and
  `--serve < /dev/null` is not one either — reading it ends at once. It asks
  whether stdin is a pipe or a socket now: Node hands a child a socketpair
  rather than a FIFO, so testing only for a FIFO would have fixed the redirect
  and broken the app. Both cases are tests. Found by the CI job added in this
  release, on its first run, which is the entire argument for adding it.

- **The website had no vertical padding.** `.wrap` set the `padding` shorthand
  to add a side gutter, and a class outranks the `header`, `section` and
  `footer` type selectors — so it zeroed the top and bottom padding of every
  block on the page. The badges spread themselves across the column for a
  related reason: `header img { margin: 0 auto }` was meant for the logo and
  matched them too, and an `auto` margin on a flex item absorbs the free space,
  which is how `justify-content: center` centred nothing.

## [1.22.0] — 2026-08-23

### Added
- **The macOS app is a real application now.** `./mac/build.sh` produces a
  signed `seo-audit.app` with its own icon, `Info.plist` and engine inside it —
  no Xcode project, because `swiftc` and the command line tools are what
  "anyone can build it" has to mean. `Package.swift` is there so Xcode can open
  the folder anyway.

  **The report is drawn natively.** No web view anywhere in the app: glass cause
  cards that expand into the pages they affect, filtering by level, search, and
  PDF export rendered from the same views that are on screen. 1,431 lines of
  SwiftUI.

  It is still not a second implementation. The app runs the CLI as a child
  process and reads its stream, and the grouping into causes travels with the
  findings — `byCause()` stays the only implementation of that rule. The seam is
  explicit in `Report.swift`: one protocol, `AuditEngine`, so a Swift engine
  later would be a second conformance and no change to any view above it.

  **`--no-node` builds a 1.7 MB app** that uses the Node already on the machine;
  the default bundles one and is 109 MB, of which 108 MB is Node and under one
  is everything this project wrote. Zipped, that is 36 MB — a quarter of what
  Slack asks for.

- **Versions, updates and downgrades.** The sidebar checks GitHub's releases
  once a day and lists every one with its notes, newest first. Moving between
  them — in either direction, because a release that makes a report worse should
  be undoable without reading a manual — runs one Homebrew command in Terminal.

  The app deliberately **does not replace itself**. That needs a Developer ID
  and notarisation to be safe, and an unsigned application rewriting its own
  bundle is indistinguishable from something you would not want. Homebrew
  verifies a checksum first; the browser leaves Gatekeeper a say.

  A Homebrew cask and a release workflow come with it: the cask's version and
  checksum are written by CI when a tag is pushed, so the formula cannot
  describe a build that does not exist.

- **The engine stream can speak JSON.** `?format=json` on `/stream` sends the
  findings, the meta and the causes instead of a rendered page. The native app
  is the only caller today; anything else that wants structured output over a
  stream can use it.

### Fixed
- **`--serve 0` asked for the help text instead of a port.** Zero is falsy, and
  `if (opts.serve)` sent it to the wrong branch — so the macOS app, which asks
  the operating system to pick a free port, opened onto an engine that never
  started. Found by building the app rather than by reading it.

## [1.21.0] — 2026-08-23

### Added
- **`--compare-as`: the same page, asked for by two different readers.** A site
  that serves one thing to Googlebot and another to a browser is either cloaking
  or misconfiguring its bot protection, and both are invisible to an audit that
  fetches once.

  Not a byte comparison — a nonce, a timestamp and a cart count all differ
  between two fetches by the same client. What is compared is what a search
  engine reads: status, title, canonical, robots meta, word count and link
  count, the last two with a tenth of slack so ordinary dynamic content does
  not fire.

  **forbes.com** serves Googlebot 225 words where Chrome gets 503, and the same
  on every page sampled. **nytimes.com** differs by 3% and correctly stays
  silent. jekyllrb.com is identical on all ten and says so, because a clean
  comparison is a result rather than an absence.

- **`--search-console`: findings ordered by what the pages actually do.** Every
  other ordering here is derived from the site's own markup and is a proxy.
  Impressions are not. Opt-in, credentials read from the environment or
  `~/.config/seo-audit/.env` and never from a repository, a domain property
  named `sc-domain:example.com`, and the window ends three days back because
  Search Console counts the last three incompletely.

  Missing credentials, or a property the account cannot read, are a note: an
  audit that dies because an optional integration failed is worse than one that
  says so. **Tested against a fake API rather than a real one** — nobody here
  has a property to point it at, so the request shape, the token exchange and
  the date window are covered by tests and the live call is not.

- **`--serve`, and a macOS app around it.** `node bin/seo-audit.mjs --serve`
  opens the same form the hosted version serves, on `127.0.0.1:4321` — no
  account, no bill, and none of a Worker's limits.

  It is not a second implementation. `worker/index.mjs` was written against
  `Request` and `Response` in 1.12.0 precisely so that Node could answer with
  it too, and `src/serve.mjs` is thirty lines of adapter between `node:http`
  and the fetch API. The Worker's password gate is satisfied rather than
  skipped — a random token is minted locally and presented on every request,
  because a bypass inside the deployed code is a bypass that can reach
  production one refactor later.

  `mac/SeoAudit/main.swift` is a window around that: it starts the CLI with
  `--serve` and points a `WKWebView` at it. A shell, never a port — no check is
  written twice.

  **Running it found a bug that reading it would not have.** The server
  outlived the app, held port 4321, and the next launch failed. A child knows
  it has a parent by stdin being a pipe, so `--serve` now exits when that pipe
  closes, and the app hands it one. In a terminal stdin is a TTY and Ctrl-C is
  still the way out.

- **Printing is a first-class output.** ⌘P on the HTML report now produces
  something worth sending: forced light colours rather than a browser's "print
  backgrounds" setting, margins, no finding split across a page break, and the
  causes taking the first page to themselves. Verified by rendering a real
  report to PDF and looking at it.

- **Causes are ordered by reach, not just by breadth.** The link graph has been
  built inside `crossPageChecks` and thrown away since 1.11.0, which meant the
  two checks that read it could disagree about the same site and nothing else
  could see it at all. It is now built once in `src/graph.mjs` and read by the
  orphan check, by click depth, and by the report.

  Every finding on a crawled page carries how many pages link to it and how far
  it is from the homepage. Causes are ordered worst first, then by **how much
  of the site points at them**, then by how many pages they cover. On
  jekyllrb.com that puts `schema-incomplete` on 7 pages with 1,047 links in
  ahead of `duplicate-title` on 10 — seven pages the site points at constantly
  beat ten it mentions once.

  Both numbers are counts of links that were actually read. Nothing is weighted
  or scored: absent stays absent, because "nothing links here" and "this was
  never measured" are different answers.

- **A section stops at two path segments.** Past that a path is usually a date
  or a taxonomy rather than a different template. jekyllrb.com's dated archive
  was becoming one section per month, so 1,206 findings arrived as 602 "things
  to change" — a number nobody can act on. Capping at two took it to 214 and
  left a Shopify store's eight sections exactly as they were.

### Fixed
- **The `--json` report keeps what the HTML shows.** `serialize()` picked five
  fields, so `indexable` — and now `reach` — never reached the file. A baseline
  still carries only the five: it is committed and diffed in git, and how many
  links point at a page changes every time the site does, so a baseline whose
  diff churns is a baseline nobody reads. The report carries everything.

## [1.20.0] — 2026-08-23

### Added
- **`--browser` and `--os`: crawl as a real browser, or as a search crawler.**
  `chrome`, `firefox`, `safari`, `edge`, `googlebot`, `googlebot-desktop` and
  `bingbot`, on `macos`, `windows`, `linux`, `android` or `ios` — defaulting to
  the system it is running on.

  Three reasons, and none of them is dressing up. A site that answers a browser
  and blocks everything else is common, and the report from a blocked crawl is
  a report about the block. Some sites serve different HTML to a crawler than
  to a person, and fetching as Googlebot is the only way to see what Google is
  given. And Google indexes what its *smartphone* crawler sees, which on a site
  serving something different to phones is the page that matters.

  Googlebot's two user agents are quoted from Google's own crawler
  documentation; Google prints the Chrome version there as the placeholder
  `W.X.Y.Z`, so a concrete one is substituted because the real crawler sends
  one.

  **A combination that does not exist is refused rather than approximated** —
  `--browser safari --os windows` describes a machine nobody has, and the whole
  point of the flag is to be believed by a server. `--os` alongside a crawler
  says so and carries on, since a crawler's user agent names no machine.

  The strings are a snapshot and will age. `--user-agent` still takes a literal
  string and outranks `--browser` when both are given.

- **Findings are grouped by cause.** A real store produced **2,081 findings
  across 347 URLs**, four checks accounting for 80% of them and 1,685 of them
  under `/products/` — which is not 1,685 problems but one Shopify template
  repeated 194 times. The report made the reader work that out, page after
  page, and most readers stop instead.

  The rule is one sentence: the same check, on pages of the same section, is
  one piece of work. A section is the path a page's template lives under —
  `/products/`, `/blogs/the-library/`, `/` — because that is how a generated
  site is built. Nothing guesses at severity or invents a score; it groups,
  counts and orders.

  That store's 2,081 findings are 62 things to change, and every report format
  now opens with the widest of them:

  ```
  ✗  No <h1>                              10 pages under /pages/
  ✗  Structured data is not valid JSON     3 pages under /collections/
  !  Heading level jumps from h1 to h3    225 pages under /products/ — 69% of the crawl
  !  Title may be truncated in results    162 pages under /products/
  ```

  Terminal, Markdown and HTML share `byCause()` and `causeScope()` so the three
  cannot drift. Under a handful of causes the section is not rendered at all —
  the list below already reads as its own summary.

### Fixed
- **A minute of slack on `schema-date-order`.** A real store produced twelve
  inversions and **eleven were exactly one second** — Shopify's theme writing
  `datePublished` and `dateModified` from timestamps that round apart. The
  twelfth was nine hours, and it was the only one anybody could act on. An
  inversion under a minute is a generator artifact and is no longer reported,
  the same way a date less than a day in the future is not.

- **A rate limit is not a missing file either.** 1.15.0 taught the page checks
  that HTTP 429 describes the crawl rather than the page; `src/site.mjs` never
  learned it. Re-running a real store on 1.19.0 reported **No llms.txt** for a
  site that serves one at 200 — it had answered 429 during the crawl, and
  `!res.ok` was being read as "absent".

  `robots.txt` and `llms.txt` now report missing only on 404, 410 or no answer
  at all. A rate limit, a 403 from bot protection or a 5xx means the answer was
  not given, and "there is no robots.txt" is an answer. The favicon check
  already worked this way, which is why it was unaffected.

- **`rate-limit-slowed` no longer claims every page was read.** In the run that
  found the above, 164 of 325 pages were rate-limited away — so the note
  explaining the slow run was contradicting the 164 findings underneath it.

## [1.19.0] — 2026-08-23

### Added
- **Four contradictions, each read off something already parsed.** None of them
  needs a request, and each reports a page disagreeing with itself rather than
  a judgement about it.

  **`img-lazy-priority`** — `loading="lazy"` and `fetchpriority="high"` on one
  image. The first says do not fetch this until it is nearly on screen; the
  second says fetch it before everything else, and the first decides when.
  `info`, not a warning, because a browser does apply the priority once a lazy
  image finally enters the queue — what it cannot be is deliberate on the image
  the page is judged on, which is the only image `fetchpriority` is usually put
  on. `images[].loading` had been parsed and read by nothing since 1.0;
  `fetchpriority` is new.

  **`content-language-mismatch`** — the `Content-Language` header and
  `<html lang>` disagreeing. Compared by primary subtag, so `en-GB` and `en`
  are the same claim, and a header listing several languages agrees with itself
  if the page's is one of them.

  **`schema-date-order` and `schema-date-future`** — structured data saying a
  page was modified before it was published, or carrying a date that has not
  happened yet. Google reads both when deciding how fresh a page is. A day of
  slack on the future, the same allowance the sitemap's `lastmod` check makes,
  and a date this tool cannot parse is a date it has no opinion about.

  **`sitemap-duplicate-url`** — the same URL listed twice, across two files of
  an index or twice within one.

  The last one needed narrowing against real sitemaps, and by shape rather than
  by name. wordpress.org lists `/` in `sitemap-1.xml` and then forty more times
  in `image-sitemap-1.xml` — 681 entries for 171 pages — because an image
  sitemap is one entry per image, which is the format working exactly as
  intended. But the namespace proves nothing: Yoast declares `xmlns:image` on
  every file it writes, and css-tricks.com's `post-sitemap2.xml` carries image
  elements while being an ordinary list of posts. So a file whose locs are
  mostly repeats is not listing pages and is not compared. wordpress.org goes
  silent; css-tricks.com keeps its real finding, one post listed in both
  `post-sitemap2.xml` and `post-sitemap3.xml`.

  The three page-level ones are silent across 49 pages of maisonetherique.com,
  css-tricks.com, smashingmagazine.com, elementor.com and wordpress.org/news.
- **`favicon-broken` and `favicon-missing`** — Google draws a favicon beside
  every result a site owns and shows a default globe where it finds none. It
  reads the declaration from the home page and accepts three `rel` values:
  `icon`, `apple-touch-icon` and `apple-touch-icon-precomposed`. Because `rel`
  is a token list, the legacy `shortcut icon` is matched by the `icon` in it
  without needing a rule of its own.

  Exactly two things are reported, both facts: a **declared** icon that is not
  there, and **no declaration** with nothing at `/favicon.ico` either. A site
  serving one from a path it never declared is working as intended, and
  guessing otherwise would be inventing a finding. One request, and the home
  page it reads was already fetched to settle the host in 1.16.0.

  Three details the real web supplied:

  - A page counts as absent. `/favicon.ico` answering 200 with HTML is the
    site's catch-all handler, and it reaches a search engine as no icon just as
    surely as a 404 does.
  - `data:,` is left alone. example.com and motherfuckingwebsite.com both ship
    the empty data URI that stops a browser asking for a favicon at all — a
    deliberate choice, with nothing to fetch.
  - The plain `icon` is preferred over the iOS ones, so an `apple-touch-icon`
    404 is not reported while a working favicon sits beside it.

  403 is not a missing favicon, the same judgement the `og:image` sweep makes.
  Silent on maisonetherique.com, jekyllrb.com, css-tricks.com, wordpress.org
  (whose icon is on another host entirely), smashingmagazine.com,
  elementor.com, example.com, info.cern.ch and textfiles.com; fires on
  danluu.com, which declares none and 404s `/favicon.ico`.

## [1.18.0] — 2026-08-23

### Added
- **`anchor-ambiguous`** — one phrase pointing at two different pages. The
  mirror of `anchor-generic`, over the anchor text 1.13.0 started keeping:
  "Collections" linking to both `/docs/collections/` and
  `/docs/step-by-step/09-collections/` tells Google the two are the same thing,
  so they compete for the query instead of one of them winning. No requests —
  the data is already in memory.

  The roadmap predicted this would be noisy before it was right, and it was.
  Four real sites narrowed it, each contributing a class of false positive:

  - elementor.com offers each logo as "SVG" and "PNG", which collides with
    every other logo on the page. A link whose text is a file format labels a
    download; asset extensions are skipped.
  - smashingmagazine.com puts "Jump to table of contents" on every ebook page,
    each pointing at its own. The words describe the movement, not the
    destination — `jump/skip/go/back/return/scroll to …` are skipped.
  - wordpress.org's download page says "md5" beside **2,730** checksums. Above
    a handful of destinations a phrase is a label in a list, not a description,
    so a collision is reported only up to five. The same page contributed
    "7 1" — a version number, which is why the digits check is not just `\d+`.
  - **Both destinations must be pages this crawl actually fetched.** Two of the
    first collisions found were not two pages at all: elementor.com's
    `/about/privacy/` 301s to `/terms/privacy/`, and smashingmagazine.com's
    `/categories/business` 301s to `/category/business`. One page under two
    URLs linked by the same words is a stale link — `link-redirects` already
    reports it — and calling it two competing pages would be false.

  What survives is quiet on partial crawls and useful on whole ones: silent
  across 30-page samples of elementor.com, smashingmagazine.com and
  wordpress.org, and on a full 210-page crawl of jekyllrb.com it finds eleven
  pairs where the reference page and the tutorial chapter carry the same words.

### Fixed
- **Typographic entities are decoded.** `&raquo;`, `&mdash;`, `&hellip;`,
  curly quotes and numeric entities were left as-is, so "here's their page
  &raquo;" normalised to a phrase with the word "raquo" in it. Found in anchor
  text; it applies to every field `parse.mjs` decodes.

## [1.17.0] — 2026-08-23

### Changed
- **The image sweep counts files, not URLs.** An image CDN serves one file at
  every size asked for — `photo.avif?v=17&width=150`, `&width=300`, `&width=750`
  — and each of those was a separate entry against the 200-image cap, and a
  separate request. `width`, `height`, `w`, `h` and `dpr` are now dropped before
  deduping.

  Measured rather than assumed, because the roadmap entry asking for this said
  to: across 45 pages of a real store, **767 distinct URLs became 488 distinct
  files**, a third of the sweep asking the same question again. A live run of
  the same 45 pages now reports 488 where it used to report 767. It is not the
  tenfold saving the mechanism suggested, and the honest number is the one
  worth writing down.

  `v` is deliberately kept. A different version is a different asset and a
  stale one really can 404, which is a finding worth keeping. The trade taken
  is that one size is checked on behalf of the others: a CDN that refuses an
  unusual width will not be caught, which errs towards saying nothing rather
  than towards saying something wrong.

- **Both capped messages name the number to set.** `image-sweep-capped` now
  says how many files the site has and what to set `maxImageChecks` to;
  `truncated` says `--limit 325` rather than "raise it with --limit". The
  report already knew both numbers.

## [1.16.0] — 2026-08-23

### Fixed
- **Site-level checks are read on the host that answers.** Auditing
  `example.com` when the site lives at `www.example.com` left `origin` on the
  host that only ever returns 301, while the crawl followed the redirect for
  pages — `discover()` has always used `chain()`. So robots.txt, llms.txt and
  every response header were read off a redirect.

  On a real store that meant three findings, none of them true: a flat "No
  robots.txt" for a site with a good one — agent instructions, a UCP endpoint,
  the lot — an llms.txt reported missing on a host that does not serve it, and
  a `Referrer-Policy` verdict taken from a 301's headers.

  The homepage's redirect chain is now followed before anything else, and where
  it settles on another host the audit moves there and says so as
  `origin-redirected`. That is what a crawler does: RFC 9309 asks for at least
  five redirects to be followed for robots.txt, and Google follows them.

  Re-running that store from its bare domain: `robots-missing` and
  `llms-missing` both went silent, and the one real finding of the three —
  no `Referrer-Policy` — is now reported against `https://www.…` and read from
  a response that actually exists. The host-variant check is unaffected: it
  strips `www.` before building its variants, so it tests the same three
  either way.

## [1.15.0] — 2026-08-23

### Fixed
- **A rate limit is no longer reported as a broken page.** A Shopify store
  answered HTTP 429 to **70 of its 200 crawled pages** at the default
  concurrency, and every one came back as `page-status` — "Page did not return
  200", at error level. The pages were fine. Requested eight seconds apart the
  same URLs answered 200, on the tool's own user agent, so it was the crawl's
  speed and nothing else.

  `src/http.mjs` treated any status under 500 as a final answer, so a 429 was
  never retried. Now it is: the run pauses globally, honours `Retry-After`
  where it is sent — Shopify sends none, hence a default that doubles to a
  ceiling of eight seconds — and **halves the concurrency and leaves it down**,
  because retrying a rate limit at the speed that caused it just spends the
  budget again. After twenty refusals it stops asking, so a host that means it
  costs a slow finish rather than an hour.

  A page that still answers 429 is reported as `rate-limited` at **info**: the
  server described the crawl, not the page. It is also no longer counted as
  "not indexable" — a page nobody could fetch has unknown indexability, and
  "not indexable" is an answer.

- **Orphans are not looked for across a crawl that did not see the site.** The
  same report called **122 pages orphans** while, three findings further down,
  declining to measure click depth because the link graph was a fragment. Both
  read the same graph. One check refusing to answer while its neighbour answers
  confidently from the same data is not a defensible position.

  `orphan-page` now stands down when the crawl was truncated by `--limit`, or
  when more than a tenth of the crawled pages did not load, and says so once as
  `orphan-check-skipped`. Click depth shares the condition so the two cannot
  drift apart.

  Re-running that store with the pages it was missing: **70 errors became 0,
  122 orphans became 5**, and 70 pages stopped being counted as not indexable.

### Added
- **`rate-limit-slowed`** — said once at the end of a run that was throttled,
  with how many times the server asked and what the concurrency came down to.
  Not a finding about the site: it is the only thing that lets an eight-minute
  run read as "slower than usual" rather than "something is wrong".

## [1.14.0] — 2026-08-23

### Added
- **`canonical-paginated`** — page 2 of an archive handing its indexing to page
  1, or to any other page of the same sequence. Google's guidance is one
  sentence long: "Don't use the first page of a paginated sequence as the
  canonical page." Page 2 is not the same content as page 1, so it is a request
  Google is under no obligation to honour and may ignore; where it is honoured,
  the whole archive after the first page leaves the index and takes with it the
  only route to every article old enough to have fallen off page 1. It is the
  click-depth story one floor up, and it arrives switched on rather than being
  chosen.

  Four of the six real archives checked while building this ship it:
  css-tricks.com, wordpress.org/news, smashingmagazine.com and
  blog.mozilla.org. The two that name themselves — elementor.com and
  sitepoint.com — are silent, which is the half that matters.

  Only two URL shapes are read, `/page/2/` and `?page=2`, because they are the
  two that can be recognised without guessing. A bare trailing number like
  `/blog/2/` is as often a year or an id, `?p=2` is a WordPress *post* id and
  not a page of anything, and `?start=`/`?offset=` have no first page to work
  back to. A shape that has to be guessed at is not read at all.

  **The check had to be put where these pages actually turn up.** A sitemap
  does not list them: 0 of 9,273 sitemap URLs across css-tricks.com,
  wordpress.org and smashingmagazine.com were paginated, so a crawl of the
  sitemap never meets page 2 and the check would have been correct and dormant.
  The internal-link sweep already fetches every link target to see whether it
  works, and was discarding the HTML — so the same response now answers a third
  question, at the cost of no extra request. Verified against the live site:
  smashingmagazine.com/articles/ links to pages 2 and 3, and both are reported,
  in the 106 requests the sweep was making anyway.

## [1.13.0] — 2026-08-21

### Added
- **`link-no-text` and `anchor-generic`** — the words attached to a link, which
  `parse.mjs` has been discarding since the first commit. They are the one
  description of a page that does not come from the page itself, which is why
  they were the last thing on the list a `fetch` loop could honestly read.

  A link's name is resolved the way a browser resolves an accessible name — the
  text inside, then an image's `alt`, then `aria-label`, then the anchor's own
  `title`, then an `<svg><title>` — because each of those is a real way to label
  a link and calling any of them unlabelled would be wrong. `aria-labelledby` is
  believed rather than followed. A framework binding (`:alt`, `[ariaLabel]`,
  `[attr.aria-label]`) counts as a label the author supplied: that is the trap
  that once made `img-alt` report twenty-four of allbirds.com's images as
  missing alt.

  **`link-no-text`** is a destination that *nothing* names. Three real sites
  taught this its final shape, each by producing a false positive first:

  - css-tricks.com's homepage has 33 links with no text at all. Every one is a
    heading-anchor icon pointing at a `#fragment`, `aria-hidden`, decorative.
    Fragment links were already excluded, so the check was right by
    construction — but it is worth knowing that this is what the pattern
    usually is.
  - elementor.com's blog index has 23 thumbnails with an emptied `alt` beside
    the headline that names the same article. Reporting those would be a true
    observation with a false conclusion attached, so a destination is only
    unreadable when *no* link anywhere names it.
  - wordpress.org/education names Campus Connect three times at
    `/campus-connect/` and once, wordlessly, at `/campus-connect`. Matching
    href strings called a page with three good links unreadable; destinations
    are now keyed without the trailing slash.

  What survives all three is genuine: elementor.com/trust links five ISO and
  SOC certificate PDFs through badge images with no `alt`, so Google is handed
  five documents it can index and nothing about any of them, and a screen
  reader reads out the filename. Grouped by destination rather than per page,
  because these live in headers and footers and the same icon on two hundred
  pages is one thing to fix.

  **`anchor-generic`** is a page whose inbound links *all* say "read more".
  Reporting each such link would fire on every blog index ever built — a card
  under a headline has to say something. The finding is the page that has
  nothing else: no link anywhere on the site tells Google what it is about.
  `info`, and the word list is deliberately short and unarguable. "Get started"
  and "Book now" are not on it; they say something about the destination.

  Silent across fitculturepilates.com, jekyllrb.com, css-tricks.com,
  smashingmagazine.com, wordpress.org, w3.org, gnu.org and freecodecamp.org —
  some 12,000 internal anchors.

### Changed
- **The HTML report can carry a way back.** `html()` takes an optional
  `{ backHref, backLabel }` and renders a link in the bar when given one. Only
  the hosted front end passes it: the report replaces the page it streamed
  into, and without this the only route back to the form was the browser's back
  button onto a stale log. A report written to a file has nowhere to go back
  to, and still renders without it.

## [1.12.0] — 2026-08-21

### Added
- **An optional hosted front end for Cloudflare Workers** — `worker/index.mjs`,
  `wrangler.jsonc`, and a deploy button, for the case where the person who
  needs an audit will not open a terminal. It imports `audit` and `html` the
  same way `bin/seo-audit.mjs` does and re-implements no check: the same crawl,
  the same findings, the same self-contained report.

  **The CLI is unchanged and is still the way to run this.** It is free, it has
  no ceiling, and it runs two checks the hosted version cannot. Nothing was
  added to `package.json`: Cloudflare's build runs `npx wrangler deploy` on
  their side, so the repository still installs nothing and `npm test` still
  needs nothing. The Worker holds to `fetch`, `Request`, `Response` and
  `TransformStream`, which Node 22 has too — so its 14 tests run under
  `node --test` like everything else.

  What the honesty rules cost here, and what they bought:

  - **It refuses to audit anything until `AUDIT_TOKEN` is set**, and says so on
    every page. Deploying is one click and setting a secret is a separate step;
    between the two, an open crawler on someone's account is not an acceptable
    default. `ALLOWED_HOSTS` narrows it further, to the hosts you name.
  - **Certificate expiry cannot be checked there** — `node:tls` is only
    partially supported by the runtime and reading a peer certificate is one of
    the missing parts. Rather than let it fail quietly, every hosted report
    carries a note saying so. A missing finding reads exactly like a passing
    one, and a report two checks shorter than the CLI's, with nothing to say
    it, is worse than no report.
  - **It cannot run on Cloudflare's free plan**, and `docs/hosting.md` says
    that first rather than in a footnote. 10ms of CPU and 50 outbound fetches
    per invocation is about sixteen pages — which is precisely the failure this
    tool exists to point at. The Paid plan is $5/month, and past that the
    marginal cost is about a hundredth of a cent per audit, because Cloudflare
    does not bill for the fetches a Worker makes.

  Progress is streamed as server-sent events while the crawl runs, because an
  audit takes a minute or two and a blank tab for that long reads as a hang.

  Verified in the real runtime, not only in theory: `wrangler dev` running
  `workerd` locally audited a real 12-page site end to end and returned a 44KB
  report, with the gate refusing an unauthenticated request, a host outside
  `ALLOWED_HOSTS`, and an unconfigured deployment. The bundle builds at 34KB
  gzipped.

- **`docs/hosting.md`** — what it costs, why the free plan cannot run it, what
  it is not allowed to reach, the two checks it cannot do, and how to turn it
  off. Including the part that is easy to leave out: deleting the Worker does
  not cancel the $5/month plan, and the charge is on your account under your
  agreement with Cloudflare, at your own risk.

### Changed
- **The logo is centred in its own box and survives a dark README.** It sat in
  a 640-wide canvas with its artwork ending at 393, so 37% of the image was
  empty space on the right and the mark drifted left of centre no matter what
  the surrounding markup said. The viewBox is now cropped to the artwork with
  even margins, measured from a render rather than guessed — an attempt to pin
  the width with `textLength` was abandoned when it turned out to break on a
  `<text>` containing a `<tspan>`, spraying the wordmark across the canvas.

  The wordmark was also `#111827` on a transparent background, which is close
  to invisible on GitHub's dark theme. There is now a `docs/logo-dark.svg` and
  the README picks between them with `<picture>`, the pattern GitHub documents.

- **The README carries the official Deploy to Cloudflare button**, centred,
  directly under the sentence saying what the plan costs — with the price and a
  link to `docs/hosting.md` immediately beneath it, because the first thing
  anyone meets should be the bill rather than the button. The badge in the
  header row points at that page too, not at the deploy flow.

## [1.11.0] — 2026-08-21

### Added
- **`deep-page`, `no-path-from-home`, `click-depth-skipped`** — how many links
  from the homepage each page actually is, measured over the link graph the
  crawl already built. No extra requests, except one for the homepage when the
  sitemap does not list it.

  `orphan-page` was reporting the extreme of this shape — nothing links here at
  all — and nothing was reporting the milder version, which is far more common:
  a page five clicks down is found late, crawled rarely, and passed almost
  nothing, while reading as perfect to every grader that opens one URL. The
  shortest route in is printed with the finding, because "five clicks" is a
  complaint and `/ → /docs → /docs/deployment → /docs/deployment/automated →
  /docs/continuous-integration/travis-ci` is a thing to go and fix. Default
  threshold is four clicks, configurable as `limits.maxClickDepth`.

  `no-path-from-home` is the page that is linked, but only from a page that is
  itself unreachable — it hangs off an orphan. Nothing reached it by following
  links from the homepage, so a crawler that has not been handed the sitemap
  never arrives. Orphans themselves are excluded: that is already a finding,
  and one page is not two problems.

  Level is `info` for depth, because depth is sometimes deliberate — an archive
  page four levels down is doing its job.

  **The measurement is declined rather than guessed at in two cases**, both
  reported as `click-depth-skipped` with the reason:

  - The crawl was truncated by `--limit`. Two hundred URLs of thirty thousand
    is a fragment of the graph, and a distance measured across a fragment is
    not the distance.
  - More than 30% of crawled pages have no path from the homepage. That is
    what a JavaScript-built navigation looks like to something that reads
    HTML — and Google renders, so it follows those links fine. eslint.org is
    the case that produced this guard: 464 of its 499 pages look unreachable
    from static HTML, and without it this would have invented 464 findings
    about a site whose navigation works.

  Verified against jekyllrb.com, where every hop of a reported route was
  confirmed by hand in the live HTML and no shorter route existed.

- **`canonical-noindex`** — a canonical pointing at a page that asks not to be
  indexed. The canonical sweep already fetched and parsed the target to check
  it was not a redirect, a 404, or the start of a chain; it never read what the
  target says about indexing.

  A canonical is a request to index B in place of A. If B is `noindex`, both
  pages leave: B because it asked to, and A because it named B as the version
  to keep. Nothing on A shows this. Its own markup is correct, its own robots
  meta says `index`, and the instruction that removes it lives on a different
  page — or in an `X-Robots-Tag` header on that page, which no view-source
  reveals. Both sources are read, exactly as they are for the page's own
  `noindex` and `x-robots-noindex`.

  Reported once per target, matching `canonical-dead` and `canonical-redirects`
  — a paginated archive canonicalling forty pages at one dead parent is one
  problem, not forty. A target that is both `noindex` and canonicalled onward
  reports the `noindex`, since the chain is the smaller half of that.

  Silent across smashingmagazine.com's four real cross-page canonicals, all of
  which point at indexable targets.

- **`viewport-locked`** — `user-scalable=no`, or a `maximum-scale` under 2, in
  a viewport that was previously only checked for existing. Text cannot then
  reach the 200% WCAG 1.4.4 asks for. Safari has ignored the setting since iOS
  10, which is why it survives: it looks fine on the iPhone of whoever tested
  it, and blocks zoom everywhere else. lufthansa.com ships it today, with
  `content` written before `name` — the reversed attribute order the parser
  had to handle to see it at all.

- **`viewport-fixed-width`** — `width=1024` where `width=device-width` belongs.
  A pixel width is a desktop layout announced to a phone: the browser lays the
  page out that wide and scales the result down, and Google indexes what its
  mobile crawler rendered. Only an explicit number fires it; a viewport with no
  `width` key at all — `initial-scale=1,user-scalable=yes`, which is what
  wikipedia.org serves — is a different question and stays silent.

## [1.10.1] — 2026-08-17

### Fixed
- **The `www.` host variant is only tried for a host that can have one.** It was
  built by string concatenation from whatever host was being audited, so
  auditing `http://127.0.0.1:8080` asked a resolver for `www.127.0.0.1` — a
  question with no sensible answer, which a resolver may decline instantly or
  sit on for as long as it likes.

  That made the test suite stall unpredictably, since every fixture test runs
  against `127.0.0.1`. It also affected anyone auditing a local build on
  `localhost`, where the same two requests were pure waste.

  IP addresses and single-label hostnames are now skipped; a registrable domain
  is checked exactly as before. Verified by intercepting `dns.lookup` during a
  fixture run — zero hostname resolutions, everything a literal IP — and by
  confirming a real domain still reports its `www.` redirect chain.

## [1.10.0] — 2026-08-17

### Added
- **`schema-incomplete`** — a type Google can render that is missing a property
  it requires. The markup is valid, the type is right, nothing reports an error,
  and the rich result simply never appears: an `Article` with no `headline`, a
  `BreadcrumbList` with no `itemListElement`, a `Product` with nothing to show.

  The list is deliberately short and covers only fields that have been stable
  for years. Google's requirements move, and a list that goes stale invents
  findings on correct markup — the one failure this tool cannot afford. A type
  it has no opinion about stays silent rather than being guessed at.

  Nodes that are references rather than definitions are skipped: `"publisher":
  { "@type": "Organization", "@id": "…#org" }` points at a full definition made
  elsewhere in the `@graph`, and reading it as a nameless Organization would
  have fired on every site that uses `@id` references.

- **`schema-image-broken`** — an image named in structured data that does not
  load. Google is told to use it for a rich result and finds nothing there,
  usually because a media library was tidied years after the JSON-LD was
  written. Same conservative rule as the other sweeps: 404, 410 or no answer.

- **`uncompressed`** — HTML served with no `content-encoding`. Not an estimate,
  which is the line this tool does not cross: it is a header, read off the
  response. Only for documents past 5KB, because a CDN skipping compression on
  a 900-byte response is doing the right thing.

- **`huge-html`** (note) — a document past 1MB before any images or scripts.
  Google reads far more than that, so this is a signal rather than a limit, and
  set high enough that a page has to be genuinely extraordinary to trip it.

## [1.9.0] — 2026-08-17

### Added
Five checks, all reading facts already on the page or in the response rather
than making a judgement about any of them.

- **`sitemap-not-indexable`** — a URL the sitemap advertises that then asks not
  to be indexed, by `noindex` or by canonicalising elsewhere. The same shape as
  robots.txt disallowing a sitemap URL: each file is defensible alone, and they
  only contradict each other when read together. Nearly free, because 1.7.0
  already worked out which pages are indexable.

  It found a circular one on smashingmagazine.com on the first run: the sitemap
  lists `/category/ai/`, which canonicals to `/categories/ai/`, which 301s back
  to `/category/ai/`. The canonical sends Google somewhere that returns it to
  where it started.

- **`robots-conflict`** — the robots meta tag and `X-Robots-Tag` disagreeing on
  index or follow. Both were already parsed and nothing compared them. Google
  resolves it by taking the most restrictive, so the page does what neither file
  says on its own, and whichever one you are reading tells you the wrong story.

- **`canonical-chain`** — a canonical pointing at a page that canonicals
  somewhere else again. The target loading was already checked; whether it
  claims itself was not.

- **`meta-refresh`** — `<meta http-equiv="refresh" content="0;url=…">`. A
  redirect that nothing treats as one, passing signals poorly, and showing a
  visitor a page you did not mean them to read when there is a delay.

- **`sitemap-too-many-urls` and `sitemap-too-large`** — the protocol's 50,000
  URLs and 50MB, counted **per file** rather than per site, since that is how
  the limits are written. A site with four 20,000-URL sitemaps is entirely legal
  and stays silent.

## [1.8.0] — 2026-08-15

### Added
- **Two checks on the image `title` attribute** — `img-title-duplicates-alt`
  and `img-title-on-decorative`, both notes.

  Deliberately *not* a "missing title" check, which is what tools normally ship
  here. A `title` is a hover tooltip: invisible on touch, unread by Google, and
  W3C guidance discourages putting anything that matters in it. An image without
  one has nothing wrong with it, so that check would fire on nearly every image
  on nearly every site.

  What is worth reporting is when `title` contradicts something on the same tag.
  Repeating `alt` verbatim adds nothing for a sighted visitor and is read twice
  by a screen reader that surfaces both — usually one CMS field populating both
  attributes. And a `title` on an image declared decorative by `alt=""` or
  `role="presentation"` is markup saying "ignore this" while attaching a tooltip
  to it; one of the two statements is wrong.

  Verified against wpbeginner.com, which carries a `title` on 26 of its 117
  images: 14 identical to the `alt`, 6 on decorative images.

## [1.7.0] — 2026-08-15

### Added
- **`nofollow`.** `noindex` was checked and its counterpart never was.
  `nofollow-page` covers the meta tag and the header, and names the combination
  when both are set — a page that is neither indexed nor followed is a full stop
  for a crawler. `internal-nofollow` (note) reports internal links the page tells
  Google not to follow.

  Fragments are stripped and self-links dropped from that second check, because
  WordPress marks every comment-reply link `rel="nofollow"` pointing at
  `#respond` on the page it is already on — which withholds no path anywhere and
  would have fired on every article of every WordPress site. Found on the first
  real run.

- **Findings are grouped by area**, not only by severity: Indexability, Content,
  Links, Redirects, Images, Social, Structured data, Multilingual, Sitemap &
  robots, Site & security, Performance. Severity says how loudly to complain;
  the area says who fixes it. In the terminal, the Markdown and the HTML.

  A test walks `src/` for every check id and fails if any lacks a category, so
  this cannot quietly rot. It caught `viewport-missing` the first time it ran.

- **Pages that will not be indexed are marked.** A finding on a page carrying
  `noindex`, or whose canonical points elsewhere, is tagged `not indexable` in
  all three formats, and the count appears in the HTML header. The same thin
  page is a problem when Google will index it and noise when it will not, and
  that distinction is often more useful than the severity.

- **`--check-external`** sweeps outbound links, off by default. Only a 404, a
  410 or no answer at all counts as broken: these are other people's servers,
  they rate-limit and bot-block, and a 403 from someone else's WAF is the most
  productive false positive this tool could invent. An outbound link that merely
  redirects is a note. `maxExternalChecks` bounds it at 100, because one machine
  hammering a hundred third parties is rude at scale.

  Both new flags are exposed on the Action too.

## [1.6.0] — 2026-08-15

### Added
- **`--verbose` prints each request as it happens.** A run was silent from the
  first line to the last: on a 53-page site, `crawling …` and then twenty
  seconds of nothing before the whole report arrived at once. A slow site looked
  exactly like a hung one, and there was no way to tell which page it was
  sitting on.

  Covers every stage that takes time — sitemap discovery, the page crawl, the
  link and image sweeps, hreflang alternates, redirect-map rules, and PageSpeed
  Insights, which announces each measurement *before* making it because each one
  costs about twelve seconds.

  Plain lines rather than a spinner or a redrawing counter, deliberately: a long
  run is exactly the one whose output gets piped to a file or read back out of a
  CI log, and neither can show a cursor trick. A timeout arrives as status `0`,
  so a stall stays on screen rather than being overwritten.

  Written to **stderr**, so `--json` and `--md` are untouched. `--quiet` wins
  over `--verbose` — asking for silence and getting a running commentary would
  be the more surprising of the two.

## [1.5.5] — 2026-08-14

### Changed
- **The HTML report was redesigned.** It read as a default stylesheet rather
  than something you would put in front of a client. Now: a masthead carrying
  the run date, the origin as the headline, and a facts line giving pages,
  requests, elapsed time and how many findings the config silenced — which the
  old header did not say at all.

  Findings became bordered cards with a severity pill, a monospace check id and
  the affected URLs in monospace, since a URL is an identifier rather than
  prose. Numbers are tabular throughout, so counts line up in a column. The
  palette is one tone per severity, used on the pill and the tally and nowhere
  else; light mode semantics were darkened to hold against white, and dark mode
  is true black. No shadows and no gradients — flat surfaces and hairline rules
  are what make a report read as a tool.

  Zero findings now renders a proper panel — *every check passed on all N
  pages* — rather than a sentence of body text. A clean audit is the result you
  most want to hand somebody.

  Still one self-contained file with **no external assets**: no stylesheet link,
  no script, no webfont, no remote image. A report that needs the network
  renders blank in an email client, on a plane, or in three years when the CDN
  has moved on. That is also why the masthead is a text wordmark and not a logo.

  `docs/report.jpg` in the README was regenerated to match, since it advertised
  a design the tool no longer produced.

## [1.5.4] — 2026-08-14

### Fixed
- **Pages in Japanese, Chinese or Thai were reported as thin.** Those scripts do
  not put spaces between words, so splitting on whitespace counted an entire
  paragraph as one. The Japanese translation of a React docs page counted 177
  words against the English original's 411 — the same page, the same content —
  and was called thin while the English one passed.

  Characters in unspaced scripts are now counted at roughly two to the word,
  the usual working equivalence. That is an approximation and a deliberately
  generous one: over-counting keeps a real page quiet, under-counting calls it
  thin, and only one of those is a finding somebody has to argue with. Latin and
  Arabic counts are unchanged — Arabic spaces its words, and its pages were
  never affected.

  Found by a fourth sweep, against docusaurus.io, ja.react.dev, aljazeera.net,
  vuejs.org and jestjs.io. Notably the only bug that sweep found: the previous
  three rounds of parser fixes held on documentation generators, on right-to-left
  markup, and on non-Latin scripts.

## [1.5.3] — 2026-08-14

### Fixed
A third sweep, against the shapes the first two missed: WordPress, e-commerce
and a JavaScript-framework front end — techcrunch.com, allbirds.com,
wpbeginner.com, linear.app and gymshark.com. 54 errors reported; 35 were the
tool's fault.

- **Framework bindings were read as the attributes they bind.** `attr()`'s
  lookbehind excluded `-` (so `data-src` was safe) but not `:` or `[`, so
  Alpine's `:src`, Vue's `v-bind:src` and Angular's `[src]` were all read as a
  real `src`. allbirds.com binds
  `:src="(cardRefs['7205190238288']?.selectedImage…)"`, and twenty-four of its
  images were reported as 404s for URLs that were never URLs. The same binding
  on `:href` produced broken links pointing at JavaScript template literals.

- **An `alt` supplied by a binding is an `alt` the author supplied.** With the
  above fixed, `:alt="item.title"` became invisible and the images started
  reporting as having no alt at all. The value cannot be read without running
  the framework, but the intent is plain, and guessing wrong at error level is
  the failure this tool exists to avoid. allbirds.com has 43 images: 40 with a
  literal alt, 3 bound, and none with neither.

- **`og:image` judged the first hop.** An og:image on `http://` that 301s to
  https loads perfectly well — every scraper follows it — and seven of
  allbirds.com's were reported as previewing blank. The chain is now followed
  and only the final answer judged, conservatively: 404, 410 or a dead
  connection, so hotlink protection is not mistaken for a missing file.

That is the third time reading only the first hop has been wrong, after soft
404s and the link-crawl seed.

### Upgrading
Take this one if you audit anything built with Alpine, Vue or Angular. 1.5.2
read `:src` and `:href` as real attributes, so a page using bindings could
report dozens of broken images and links that do not exist. This release only
removes findings.

## [1.5.2] — 2026-08-14

### Fixed
A second sweep, against gov.uk, blog.cloudflare.com, smashingmagazine.com,
nextjs.org and python.org. 41 errors reported; 22 of them were the tool's fault.

- **`robots-blocks-all` did not read groups.** It tested for a `Disallow: /`
  line and a `User-agent: *` line existing *somewhere* in the file, which are
  routinely different groups. gov.uk blocks `deepcrawl` and python.org blocks
  `HTTrack`; both were reported as blocking their entire site from everyone, at
  error level. It now asks `src/robots.mjs` — the correct matcher that had been
  sitting unused since 1.3.0 — whether Googlebot may fetch `/`.

- **Markup built inside a `<script>` was read as page content.**
  smashingmagazine.com's offline-article list assembles `<li><a href="'+a.url+'">`
  by string concatenation, and ten pages were reported as linking to a page that
  does not exist. Elements are now read from markup with `<script>` and
  `<style>` contents removed. JSON-LD is still read from the original, because
  it lives inside a script.

- **Unquoted attribute values were invisible.** HTML permits `name=viewport`
  without quotes and minifiers emit it; `attr()` read only quoted and bare
  forms, so smashingmagazine.com had ten pages reported as having no viewport
  meta at all.

Fixing the last two revealed three findings that had been masked, each verified
by hand: gov.uk really does list `/search/all` in its sitemap while `robots.txt`
disallows it, and smashingmagazine.com's canonicals really do point at URLs that
301 elsewhere. Reading an unquoted attribute is what made that canonical
visible in the first place.

### Upgrading
Worth taking promptly, for the same reason as 1.5.1: `robots-blocks-all` is an
**error**, and 1.5.1 raised it on any site whose robots.txt blocks a single
badly-behaved crawler in its own group — telling people their whole site is
unindexable when it is not.

The parser fixes remove far more findings than they add, but they do add some:
a page whose `<meta name=viewport …>` was unquoted stops reporting a missing
viewport and starts being checked properly, so a canonical or a description that
was invisible can now produce a finding of its own. Those are real, and were
being missed rather than newly introduced.

## [1.5.1] — 2026-08-14

### Fixed
Three false positives, all found by running 1.5.0 against five real sites and
checking every error it reported. Ten errors across those sites; six were the
tool's fault.

- **`mixed-content` fired on ordinary hyperlinks.** It matched any
  `href="http://…"`, so `<a href="http://old-friend.test/">` and an RSS
  `<link rel="alternate">` were reported as insecure resources — at error level,
  on wordpress.org, developer.mozilla.org and vite.dev, every instance an
  outbound link to somebody else's site. Mixed content means a subresource the
  browser *loads*: `src` on img, script, iframe, video and friends, and `href`
  on a stylesheet link. A hyperlink is not one, and a browser does nothing about
  it.

- **Markup inside an attribute value was read as part of the page.**
  astro.build stores an entire Astro component in a `data-code` attribute for
  its copy button, and the `<img src={product.imageUrl}>` inside that string was
  reported as an image with no alt. Attribute values containing whole tags are
  now blanked before anything is extracted — narrowly, so `title="a < b"` and a
  meta description containing a `<` are untouched.

- **`role="presentation"` now counts as declaring an image decorative**, the
  same as `alt=""`. It is the ARIA way of saying it, screen readers honour it,
  and mozilla.org's accessibility team ships it — which is about as good as
  evidence gets that it is a deliberate choice rather than an oversight.
  Reporting a deliberate choice as an error is how a report gets ignored.

Also: an `<img>` with neither `src` nor `alt` described itself as `First: null`.

### Upgrading
Worth taking promptly if you run `--fail-on error` in CI. `mixed-content` is an
**error**, and 1.5.0 raised it on any `<a href="http://…">` — which means a
build could be failing over an outbound link to somebody else's site. This
release only ever removes findings; nothing new is reported.

## [1.5.0] — 2026-08-14

### Added
- **Running the bare command asks for a URL** instead of printing help and
  exiting 2. It asks two questions, then prints the one-line command it
  assembled and runs that — the point is to teach the flags, not to hide them
  behind a menu, so the second use needs no questions at all.

  Only when both stdin and stdout are a terminal. In CI, in a pipe, under
  `| tee`, or in an editor's task runner, the help text is still the answer: a
  prompt that blocks a build waiting for input nobody can type is much worse
  than the help it replaced. There is a test that spawns the binary with a
  closed stdin and asserts it exits rather than waiting.

- **TLS certificate expiry** — `tls-expiring` (warning) inside 14 days,
  `tls-expired` (error) after. Not an SEO check, and the only thing in this tool
  that takes a site off the internet completely: a browser refuses to load an
  expired certificate, at which point nothing else in the report matters. The
  certificates that lapse are the ones nobody was worried about, which is why
  two weeks of notice is the useful amount.

  The inspecting connection sets `rejectUnauthorized: false`, deliberately and
  only here. An expired certificate fails the handshake, so a validating
  connection cannot read the one fact this exists to report — the check would go
  silent in exactly the case it is for. Nothing is sent over the socket, and
  nothing is read but the certificate's dates, which are the ones a browser
  would show. Verified against `expired.badssl.com`, which reads as 4141 days
  past expiry rather than as an unreadable host.

### Upgrading
`@v1` moves forward. No flag renamed, no config key changed, and a scripted run
behaves exactly as before.

`tls-expired` is a new error, but it only fires on a certificate that has
already expired — at which point browsers are refusing to load the site and a
red build is the least of it. `tls-expiring` is a warning with two weeks of
notice.

The no-argument prompt only appears when both stdin and stdout are a terminal.
Anything scripted, piped or running in CI still gets the help text and exit 2.

## [1.4.0] — 2026-08-14

Three changes to what the tool audits, rather than to what it checks for.

### Added
- **`--redirects <file>` checks a migration's redirect map** against the live
  site. A map is written once, verified once, and then rots: a later change to a
  destination turns an entry into a hop through a 404, and nothing tells anyone.
  The old URLs carry the links and the rankings, which makes this one of the few
  SEO failures that is both expensive and completely silent.

  Reads the Netlify `_redirects` shape, which is also what people write by hand,
  with `to` and the status both optional. Reports `redirect-dead` and
  `redirect-broken` as errors, and `redirect-not-applied`, `redirect-hops`,
  `redirect-elsewhere` and `redirect-temporary` as warnings. A rule that works
  in one hop reports nothing.

  Rules with a `*` or a `:placeholder` match a shape rather than a URL, so
  asking for them literally proves nothing — they are counted and reported
  rather than guessed at. Findings are aggregated by outcome, because a
  migration map runs to hundreds of entries and one finding each would be a wall
  nobody reads. `maxRedirectChecks` bounds the work and says when it bites.

- **A site with no sitemap is crawled by following links**, instead of stopping
  dead. The sites least likely to have been looked after were exactly the ones
  this refused to look at. `www.mozilla.org` went from 0 pages audited to a full
  crawl with 20 distinct checks firing.

  The crawl obeys `robots.txt` — a crawler that ignores it is rude, and here it
  would also spend the budget on the pages nobody wants indexed. It skips
  assets, and treats two URLs redirecting to one page as one page.

  It also follows a redirecting homepage, which real sites forced: `/` on
  `www.mozilla.org` answers 302 to `/en-US/`, and reading only the first hop
  finds a redirect with no links in it and concludes the site has one page.
  This is the one place in the tool that follows redirects rather than
  reporting them, because a link crawl has to land where a visitor lands.

- **Multi-site runs.** `seo-audit one.example two.example` — or a `sites` array
  in the config — audits a portfolio and prints one table, worst site first.
  This is the question a per-site report can never answer, because each report
  only ever sees its own site.

  A `sites` entry may be a bare URL or an object carrying its own settings,
  because a portfolio is not a list of interchangeable sites: one has a
  deliberately short contact page, another has no journal to expect
  `BlogPosting` on. Overrides land on top of the shared config, and `ignore`
  accumulates rather than replacing — a portfolio-wide rule and a site rule are
  both meant to apply. URLs on the command line replace the configured list
  entirely, which is how you audit a subset of a portfolio.

  `--md` and `--html` write one file with the table on top and each site's full
  report underneath, so a section can be lifted out and sent to whoever owns
  that site. `--json` writes one object with a `sites` array. The run exits 1 if
  **any** site fails: a portfolio check that passes while a site in it is broken
  is a check nobody can trust.

  Sites are audited one at a time. Interleaved progress from twenty hosts is
  unreadable, and each audit is already parallel inside itself.

  `--baseline`, `--against` and `--update-baseline` compare a site against
  itself, so with more than one site they refuse to run and say why rather than
  half-answering. The baseline file format is single-site; a portfolio
  regression guard needs a format that holds several, and that is its own piece
  of work.

  Nothing changes for a single site — same output, same exit code, same flags.

### Changed
- `no-sitemap` is a **warning** rather than an error. It used to mean "there is
  nothing here to audit", which was true and is not any more. A missing sitemap
  is worth saying and is rarely worth failing a build over, now that the pages
  get checked anyway. A site that has no sitemap *and* serves no crawlable
  homepage reports `nothing-crawlable`, which is an error.
- `missing-from-sitemap` is silent during a link crawl. Every page found that
  way is absent from a sitemap that does not exist, and saying so once per page
  would bury the finding that matters.

### Upgrading
`@v1` moves forward: no flag renamed, no config key changed, and a single-site
run behaves exactly as before.

Two things to know if you script this tool:

- **Extra positional arguments used to be ignored and now mean something.**
  `seo-audit a.example b.example` audited only the first; it now audits both and
  prints a portfolio table. If you were passing stray arguments and relying on
  them being dropped, they will be crawled. Combined with `--baseline`,
  `--against` or `--update-baseline`, a second URL now exits 2 with an
  explanation rather than quietly auditing one site.
- **`no-sitemap` went from error to warning**, which can only turn a red build
  green. The pages are audited either way now. A site that is genuinely
  un-auditable reports `nothing-crawlable`, which is an error.

New errors are otherwise confined to things you opt into: `redirect-dead` and
`redirect-broken` only appear with `--redirects`.

## [1.3.0] — 2026-08-13

The checks that only fail on translated pages and in generated files.

### Added
- **robots.txt contradicting the sitemap** (`robots-blocks-sitemap-url`, error).
  The sitemap asks Google to index a URL while robots.txt forbids fetching it,
  so it lands in the index with no description, or not at all. One of the two
  files is wrong, and nothing about either one on its own looks wrong.

  This needed a real robots.txt reader rather than a regex, in `src/robots.mjs`.
  `Allow` and `Disallow` are not first-match-wins: the longest pattern wins and
  a tie goes to `Allow`. A `Disallow`-only implementation would have reported
  every site that carves an exception out of a broad block — which is what
  wordpress.org does, and it was the first real file tested against. Wildcards
  and the trailing `$` anchor are honoured, an empty `Disallow:` blocks nothing,
  and a `googlebot` group takes precedence over the `*` group.

  Skipped entirely when `robots-blocks-all` has already fired, which would
  otherwise restate the same problem once per URL.

- **`lastmod` hygiene.** `sitemap-lastmod-missing` (note), `-identical` (note)
  and `-future` (warning). The interesting one is `identical`: a generator
  stamping build time on every URL looks diligent and is worth nothing, because
  the dates never distinguish one page from another and crawlers stop reading
  them. It needs five dated URLs before it will say so — a five-page brochure
  site genuinely does get rebuilt all at once. `future` allows a day of slack,
  since a build machine with a skewed clock is a different problem.

  `parseSitemap` gained an `entries` array pairing each `<loc>` with its own
  `<lastmod>`, read from inside the `<url>` block so a date cannot drift onto a
  neighbour. `urls` is unchanged and still a list of strings — every caller
  wants exactly that, and changing it would have rippled through discovery for
  no gain.

- **hreflang, past reciprocity.** Reciprocity was the hard part and was already
  covered; these are the rest, and they only ever fail on translated pages —
  which is to say, on the pages a homepage grader never opens.

  - `hreflang-invalid` (error) — a malformed code. Only the *shape* is checked,
    never whether the codes exist: validating against ISO lists would mean
    embedding them, and a stale list is worse than no check. The shape alone
    catches the common slip, which is `en_US` with an underscore.
  - `hreflang-no-self` (warn) — a set that lists every translation except the
    page it is on, leaving the set incomplete.
  - `hreflang-lang-mismatch` (warn) — `<html lang="en">` on a page its own
    hreflang calls `ru`. Google reads both, and one of them is wrong. Dialects
    are not contradictions: `lang="en"` with `hreflang="en-GB"` is the same
    claim, and only the primary subtag is compared.
  - `hreflang-no-x-default` (note) — reported once for the site rather than on
    every page, because on a translated site the answer is the same everywhere.
  - `hreflang-dead` (error) — an alternate that does not load, including
    versions outside the crawl, which is where a stale translation URL survives
    unnoticed. Grouped by the page that declares them: wordpress.org names 52
    locale subdomains for a page that exists in 7 of them, which as one finding
    per target would have been 45 lines saying the same thing.

### Upgrading
Nothing renamed, no exit code or config shape changed, so `@v1` moves forward.
As in 1.2.0, two of these are **errors** — `hreflang-dead` and
`robots-blocks-sitemap-url` — so `--fail-on error` can turn red on a site that
has not changed. Both are contradictions rather than judgement calls: a
translation that does not load, and two files disagreeing about whether a page
should be crawled. `--fail-on new` with a `--baseline` keeps a build green while
the backlog is worked through.

Sites with no translated pages and no `Disallow` rules will see nothing new
except possibly a `lastmod` note.

## [1.2.0] — 2026-08-13

### Added
- **Soft 404s** (`soft-404`). A URL that cannot exist has to answer 404; when it
  answers 200 instead, every typo, stale inbound link and crawler guess becomes
  an indexable copy of the error page. Nothing on a site reveals this — you have
  to ask for something missing, which no visitor and no single-page grader does.

  The probe follows the redirect chain and judges only the final answer, which
  real sites forced: wikipedia.org answers `301 → 404`, which is correct and
  must stay silent, while vercel.com answers `308 → 307 → 307 → 200` — a
  trailing-slash normalisation ending in a soft 404 that reading the first hop
  would miss completely. Landing on the homepage is reported separately, and a
  soft 404 carrying `noindex` is a warning rather than an error, because the
  damage stops at the index.

- **`X-Robots-Tag: noindex`** (`x-robots-noindex`). The same instruction as the
  meta tag, sent as a header — invisible in the HTML, so it survives every
  review of the markup, and binding on Google exactly as hard.

- **Broken images** (`broken-image`). The link sweep read anchors only, so a
  404ing `<img>` on page 23 has never been visible to this tool, which is the
  precise shape of bug it was written for. Deliberately conservative: only
  404, 410 and a dead connection count. A 403 is hotlink protection working as
  designed, and reporting those would repeat the `/cdn-cgi/` mistake. A host
  that rejects `HEAD` with 405 or 501 is retried with `GET` before judgement.

- **Relative `og:image`** (`og-image-relative`). Open Graph requires an absolute
  URL; a scraper has no page context to resolve `/og.jpg` against, so the
  preview comes out blank while the markup looks perfectly reasonable.
  Protocol-relative URLs are accepted, because scrapers do resolve them.

- **Internal links that redirect** (`link-redirects`, note). Aggregated into one
  finding, since keeping an old permalink alive on purpose is legitimate.

- **Capped sweeps say so.** `link-sweep-capped`, `image-sweep-capped` and
  `missing-from-sitemap-more`. A truncated run that stayed quiet described a
  fraction of the site in the voice of a complete audit.

- `maxImageChecks` bounds the image sweep. `maxLinkChecks` is now documented,
  having been readable only from the source — which stopped being acceptable
  the moment a finding started telling people to raise it.

### Changed
- Broken links and broken images are reported in source order rather than
  whichever request finished first, so two runs of an unchanged site produce
  identical reports and `--baseline` stops seeing movement that is not there.

### Fixed
- `maxLinkChecks` now bounds the whole link sweep, not just half of it. The
  broken-link pass respected the cap while the "linked but not in the sitemap"
  pass looped over every target, uncapped and one request at a time — so on a
  site with 500 link targets, 300 serial requests happened that nothing was
  limiting. Both questions are now answered from one pass.

  The two passes were never fetching the same URL twice: `Fetcher` caches by
  method and URL, so anything the first pass had already asked for was free.
  What was not free was everything past the cap, which the first pass had never
  requested.

### Upgrading
Nothing renamed, no exit code or config shape changed, so `@v1` moves forward.
Read this one before upgrading a build that is currently green, though: unlike
1.1.0, several of these checks are **errors**, so `--fail-on error` — the
default — can turn red on a site that has not changed. `soft-404` is the likely
one, because returning 200 for unknown URLs is the default behaviour of several
popular hosts and frameworks.

That is the check doing its job, and it is worth fixing rather than silencing.
If you need the build green while you get to it, `--fail-on new` with a
`--baseline` tolerates the backlog you already have and fails only on a
regression, which is what it was built for. `--ignore soft-404` is the blunter
option.

## [1.1.0] — 2026-08-13

### Added
- **Alt-text quality**, not just presence. Nine images sharing one alt text
  passed every previous check and helped nobody. Four new checks: `alt` that is
  really a filename (`img-alt-filename`), `alt` that names the medium rather
  than the content (`img-alt-placeholder`), three or more images sharing one
  `alt` (`img-alt-duplicate`), and `alt` too long to be read in one breath
  (`img-alt-long`).

  `alt=""` is still never judged — it is the correct, deliberate way to mark a
  decorative image, and treating it as a defect would punish sites for getting
  it right. Repeated alt starts at three images rather than two, because a
  gallery of near-identical product shots is a fair reason for two.

- **`--psi` takes a section**, not just a list of pages. `--psi "/journal/**"`
  measures a sample of the crawled pages under a path instead of making you
  name each one. `--psi-sample <n>` sets how many, default 3.

  The sample is spread across the section rather than taken off the front, so a
  template regression late in a section is not missed, and it is deterministic,
  so `--baseline` compares like with like instead of reporting the sample
  itself as a change. When a glob matches more pages than were measured, the
  report says so: a silent cap would read as a clean bill of health for a
  section that was mostly never looked at.

### Changed
- `psi` paths in a config file are now resolved against the origin the crawl
  settled on, rather than the target string as typed. Same result for an
  ordinary run; correct for one that was given a bare hostname.

### Upgrading
Nothing renamed, no exit code or config shape changed, so `@v1` moves forward
to this release. One thing to expect: `img-alt-filename` and
`img-alt-placeholder` are **warnings**, so a build running `--fail-on warn` can
turn red on a site that has not changed. That is the new checks finding
something real, but it will arrive as a surprise. `--fail-on new` with a
baseline exists for exactly this — it tolerates the backlog you already have
and fails only on a regression.

## [1.0.1] — 2026-08-08

### Fixed
- A host that accepts the TLS handshake and then never answers is now reported
  as **unreachable**, with the likely cause, instead of "No sitemap found".
  Bot protection stalling non-browser clients is a completely different
  problem from a missing sitemap, and the old message sent people to look in
  the wrong place.
- Discovery gives up after three timeouts against a host that has never once
  answered, rather than paying the full timeout for every candidate. A
  tarpitting host now fails in about a minute instead of four.
- "No sitemap found" lists every location that was actually tried, so the fix
  is obvious.

### Added
- `--user-agent <ua>`, for hosts that block on the user agent.

## [1.0.0] — 2026-08-08

The first version meant for other people's projects.

### Added
- **A test suite** — 42 tests over `node:test`, no install, serving their own
  fixture site on localhost so they run offline and cannot be broken by a real
  site changing. Writing them immediately found a parsing bug: `\b` treats the
  hyphen in `data-src` as a word boundary, so a lazy-loading site had its
  `data-src` read as `src`.
- CI on Node 18, 20 and 22.
- `--against <url>` — compare two deployments directly, hosts ignored. A
  preview against production, without a baseline file.
- `--settle <seconds>` — wait until a site serves consistent HTML before
  crawling. A CDN rolls a deploy out unevenly, and a crawl during that window
  produces a snapshot that is wrong in a way nobody can reproduce. This misled
  three verifications on one project before it became a feature.
- `--version`.
- Retries for transient failures, and deliberately none for a refused
  connection or an unknown host, which are answers rather than blips.
- New checks: heading hierarchy (scoped to `<main>`, so footer furniture does
  not count), canonical targets that redirect or 404, trailing-slash
  inconsistency, URL hygiene (uppercase, underscores, spaces), and a missing
  charset declaration.
- Action: sticky pull-request comments, `notes` and `pages` outputs, and a
  `settle` input.
- `CONTRIBUTING.md`, `SECURITY.md`, issue templates, and a README written for
  someone who has never seen the tool.

### Fixed
- **The Action ran `main` regardless of the version referenced**, so pinning
  `@v1` pinned nothing. It now runs the code shipped with that version.
- `--limit` made every uncrawled page look like it was missing from the
  sitemap. The check now compares against the full sitemap, not the subset
  that was crawled.
- Attribute matching no longer confuses `data-src` with `src`.

### Notes
- `v1` is a compatibility promise: flags, exit codes, the JSON shape and the
  config format will not change under it.

## [0.3.0] — 2026-08-08

### Added
- `--html <file>` — a self-contained HTML report. One file, no assets, light
  and dark aware, prints cleanly: the format you send to a client.
- `--psi <urls>` — performance, measured by Google rather than estimated here.
  Returns the performance score, LCP and CLS against Google's own good/poor
  thresholds, every opportunity worth 250ms or more in Google's words, and the
  Chrome field data when a site has enough traffic — which is the number that
  actually counts for ranking. ~12s per URL, so it takes a list of pages, never
  the sitemap, and never runs by default. Key read from `PSI_API_KEY` or
  `~/.config/seo-audit/.env`.
- `--psi-strategy mobile|desktop`.
- **GitHub Action** (`uses: nurkamol/seo-audit@main`) — writes a job summary
  table, exposes `errors` and `warnings` as outputs, leaves the HTML report as
  an artifact. Adding this to a project is now one file.
- `limits` in the config: `titleMin`, `titleMax`, `descMin`, `descMax`,
  `thinWords`, `slowMs`. A documentation site and a shop disagree about what
  "thin" means and the tool should not hold the opinion.
- Orphan detection — pages in the sitemap that nothing links to, so they
  collect no internal authority.
- The mirror image: pages linked from the site but missing from the sitemap.

## [0.2.0] — 2026-08-08

Turns the report into a regression guard.

### Added
- `--json <file>` — machine-readable output, and the format a baseline uses.
- `--baseline <file>` — compare against a previous run and report only what
  changed: fixed, new, unchanged. `--fail-on new` fails a build on a
  regression while tolerating the backlog you already know about, which is
  what keeps the check from being switched off in week two.
- `--update-baseline` — rewrite the baseline after comparing.
- Configuration file (`seo-audit.config.json`, or `--config`): `ignore` rules
  by check id, optionally scoped to URL globs, so findings a site has decided
  to live with stop drowning the ones that matter. `*` stops at a slash, `**`
  does not.
- `--ignore <ids>` for silencing a check for a single run.
- `expect` in the config: assert that a group of pages carries the schema
  types it should. The difference between "the JSON-LD parses" and "this
  article is actually marked up as an article" — it catches a template
  quietly dropping its structured data.
- The run summary reports how many findings were ignored, so a config that
  hides too much is visible rather than silent.

### Fixed
- Sitemap discovery reads the `Sitemap:` line in `robots.txt` before guessing
  filenames, and follows redirects. Guessing alone missed Yoast's
  `/sitemap_index.xml` on the first WordPress site it met.
- Cloudflare's `/cdn-cgi/l/email-protection` links are no longer reported as
  broken. They answer 404 to anything that is not a browser, by design.

## [0.1.0] — 2026-08-08

First working version.

### Added
- Sitemap crawler with a concurrency cap and a per-URL response cache, so no
  page is fetched twice however many checks want it.
- Per-page checks: status and redirects, `noindex`, title, meta description,
  `h1`, `lang`, viewport, canonical, Open Graph tags, `og:image` format,
  JSON-LD validity, image `alt`, image dimensions, `srcset`, word count,
  in-content links, mixed content.
- Cross-page checks: duplicate titles, duplicate descriptions, and `hreflang`
  reciprocity — Google drops one-way pairs, and nothing on a single page can
  reveal that.
- Site-wide checks: `robots.txt`, `llms.txt`, host and scheme redirect hops,
  security headers, a full internal-link sweep for 404s, and whether every
  `og:image` actually loads.
- Terminal report grouped by check, and a Markdown report for committing,
  diffing between runs, or sending to a client.
- `--fail-on error|warn|never` with a matching exit code, for CI.

### Notes
- Performance is out of scope on purpose — see the README.
- Zero dependencies: Node 18+ and nothing else, so `npx` works on a bare machine.

[Unreleased]: https://github.com/nurkamol/seo-audit/compare/v1.35.0...HEAD
[1.35.0]: https://github.com/nurkamol/seo-audit/compare/v1.34.0...v1.35.0
[1.34.0]: https://github.com/nurkamol/seo-audit/compare/v1.33.1...v1.34.0
[1.0.1]: https://github.com/nurkamol/seo-audit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nurkamol/seo-audit/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/nurkamol/seo-audit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/nurkamol/seo-audit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nurkamol/seo-audit/releases/tag/v0.1.0
