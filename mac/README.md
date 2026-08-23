# seo-audit for macOS

A window over the same engine the terminal runs. The checks live in `../src`,
and there is no second copy of any of them here — a check written twice is a
check that drifts, and this project ships several a week.

```bash
./mac/build.sh --run
```

That is the whole build. No Xcode project, no package manager, no dependencies:
`swiftc` and the command line tools, which is what "anyone can build it" has to
mean.

## What it is

SwiftUI throughout, on macOS 26 or later for Liquid Glass. The report is drawn
natively — glass cause cards that expand into the pages they affect, filtering
by level, search, and PDF export rendered from the same views that are on
screen. There is no web view in the app.

What it is *not* is a second implementation. The engine runs as a child
process — `node bin/seo-audit.mjs --serve 0` — and the app reads its stream. The
grouping of findings into causes travels with the findings, computed once by
`src/causes.mjs`, because a Swift copy of that rule would be exactly the drift
everything else here refuses.

`Report.swift` defines the seam:

```swift
protocol AuditEngine {
    func run(site: String, limit: Int) -> AsyncStream<AuditEvent>
}
```

If the engine is ever rewritten in Swift, that is a second conformance and
nothing above the line changes — every view, animation and model stays.

## Size

```
./mac/build.sh              109 MB   Node inside, runs on a Mac with nothing installed
./mac/build.sh --no-node    1.7 MB   uses the Node already on the machine
```

The difference is one file. Node is 108 MB of that bundle; everything this
project wrote is under one megabyte. Zipped for download the bundled build is
about 36 MB.

Take `--no-node` if the person running it is a developer. Take the default if
they are not, and accept that a self-contained app costs what a self-contained
app costs — a quarter of what Slack asks for.

## What it needs

macOS 26 or later, and Apple Silicon. Liquid Glass is a macOS 26 API, and the
released build carries an arm64 Node — a universal one would be two Nodes and
216 MB. Building it yourself on an Intel Mac works if you have the macOS 26 SDK.

## Installing

```bash
brew tap nurkamol/seo-audit https://github.com/nurkamol/seo-audit
brew trust nurkamol/seo-audit
brew install --cask seo-audit
```

`brew trust` is not optional: Homebrew 6 refuses to load a cask from a tap
nobody has vouched for, and the message it prints when you skip it is easy to
scroll past. The cask then clears the quarantine flag after installing, which
is what lets an ad-hoc signed app open without the dialog — Homebrew has
already checked the download against a checksum written by the build that
produced it.

The cask's version and checksum are written by `.github/workflows/mac-release.yml`
when a tag is pushed, so the formula cannot describe a build that does not
exist.

## What the window reaches, and what it does not

`src/options.mjs` is the answer, and `npm test` enforces it: every flag the
command line parses carries either `app: true` or a sentence saying why the
window does not reach it. Adding a flag without deciding fails the build, and so
does claiming the window sends something it does not.

It is served at `/options` too — `run` is what a client should send, `notInApp`
is everything else with its reason.

## Settings

`⌘,` — seven panes with a sidebar, the way macOS lays out System Settings. It
was one form and it grew to about two thousand points of height: everything was
reachable and nothing was findable, and a scrollbar is a poor table of contents.

| Pane | |
|---|---|
| **Crawl** | `--concurrency` as Gentle / Normal / Fast — one, six or twelve connections. Named rather than numbered, because "6" is not a thing anybody knows they want and "this site keeps refusing me" is. Plus `--sitemap`, for one the usual names miss |
| **Coverage** | `--limit`, and `--check-external` |
| **Identify as** | The browser and OS presets from `src/agents.mjs`, fetched from `/agents` rather than listed again in Swift, and `--user-agent` for a string of your own. Setting your own greys out the two menus rather than silently winning |
| **Performance** | `--psi`: off, the home page, or a sample of up to ten, mobile or desktop. A key is optional and the engine finds it the same two ways the CLI does — **this app never holds one** |
| **Silenced** | `--ignore`. Right-click a finding to silence its check; this is where it is undone |
| **Reports** | How many are kept and what they weigh, where they live, and a way to delete them all |
| **Updates** | The version, whether to check automatically, when it last did, and a way to check now |

Anything left at its default is **not sent**, so the engine's defaults stay
written down in the engine.

## Exporting a corrected sitemap

**Sitemap (XML)** in the Export menu is `--write-sitemap`. It is built by the
engine and travels with the report, because rebuilding it needs per-page data
the app is never sent otherwise — so it is always asked for, and costs one
already-cached request.

When the engine refuses — a crawl that stopped at its limit, pages unread
because of rate limiting — the menu item is **disabled and shows the reason in
place of its description**, rather than being absent or writing a short file.

## Preview, before spending the minutes

**Preview** on the entry screen is the engine's `--dry-run`: it settles the
host, reads robots.txt and the sitemap, and says how many URLs are listed, how
many the page limit would check, and where the weight of the site is. Three
requests and a second, rather than minutes and several hundred requests to
somebody else's server to find out it was pointed at the wrong site.

It describes the crawl that would actually happen rather than an ideal one. A
site with no sitemap comes back saying links would be followed and that a count
is not knowable in advance, instead of a made-up number.

## Updates, and why the app will not replace itself

The sidebar checks GitHub's releases once a day and shows every version with its
notes, newest first. Moving between them — in either direction, because a
release that makes a report worse should be undoable without reading a manual —
runs one Homebrew command in Terminal.

Three sources, in that order, because the first one is not reliable enough to be
the only one:

| | |
|---|---|
| `api.github.com` | The full answer, including which releases are prereleases. Sixty anonymous requests an hour **per address**, shared with every other tool on the machine that talks to GitHub — so a 403 here is ordinary |
| `releases.atom` | The same releases from `github.com`, which does not spend that quota. It cannot say what is a prerelease, so a list read from it is **shown but never used to announce an update**, and the sheet says where it came from |
| The last list that worked | Kept in Application Support. A sheet that has ever succeeded never opens empty again — GitHub refusing an hour later is not a reason to forget what it said |

If all three come up empty the sheet says so and offers the releases page,
rather than showing an error above an empty list.

The app does **not** download and swap in a new build of itself. Doing that
safely needs a Developer ID and notarisation; doing it without them is
indistinguishable from something you would not want on your machine. Homebrew
verifies a checksum before it replaces anything, and the browser leaves
Gatekeeper a say. Either is better than an unsigned application rewriting its
own bundle.

## Signing

The build is **ad-hoc signed**: it runs on the machine that built it, which is
what building it yourself means. Distributing it to somebody else needs a
Developer ID certificate and notarisation, and neither belongs in a repository.
The cask strips the quarantine flag after installing, which is the same thing
you would otherwise do by hand in the Finder.

## Opening it in Xcode

`Package.swift` exists so Xcode can open this folder directly. It builds the
executable; `build.sh` is still what wraps that in a bundle with its icon, its
`Info.plist` and its engine. There is deliberately no `.xcodeproj` — a checked-in
project file is a thing to maintain, and it would make building this *harder*
for anyone without Xcode.

## Tests

```bash
swift test
```

Forty-three, over the models, the URL normalising, version ordering, the
library, the releases feed, the version cache, the PDF writer, what the settings
send, that the app keeps everything in one folder, which runs a comparison
offers, what a preview reports, and what silencing and PageSpeed put on a run. The one that matters decodes a **real engine payload** captured from a
live run and kept as a fixture, because the way this app breaks is the engine
changing its output and nothing noticing until a window is opened. CI captures
a fresh payload on every change and checks the app still decodes every field it
needs.

The views are not tested. A snapshot test of a glass card asserts what the
design happens to be today and fails every time it improves, which teaches a
team to delete tests.

## Files

| | |
|---|---|
| `SeoAuditApp.swift` | the app, its window and its menu commands |
| `Engine.swift` | starts the CLI, reads its stream, conforms to `AuditEngine` |
| `Report.swift` | the models, and the seam |
| `ContentView.swift` | the window, the session, the stage that morphs |
| `Stages.swift` | asking for a site, and watching it crawl |
| `ReportView.swift` | the report: cause cards, filters, pages |
| `Library.swift` | reports kept on disk, and the sidebar that lists them |
| `CrawlSettings.swift` | what a run does, and the query it becomes |
| `SettingsScene.swift` | ⌘, — seven panes and the sidebar that finds them |
| `Design.swift` | the four radii every surface is built from |
| `Comparison.swift` | two runs of one site, and what moved |
| `Support.swift` | the one folder this app keeps things in |
| `PDF.swift` | the report on paper — A4 pages, the engine's areas, every affected page |
| `Updates.swift` | releases, versions, and the command that moves between them |
| `AtomReleases.swift` | the releases feed, for when the API has had enough |
| `VersionsSheet.swift` | every release and what changed in it |
| `PDF.swift` | the report as paper |
