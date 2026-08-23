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

## Installing

```bash
brew tap nurkamol/seo-audit https://github.com/nurkamol/seo-audit
brew install --cask seo-audit
```

The cask's version and checksum are written by `.github/workflows/mac-release.yml`
when a tag is pushed, so the formula cannot describe a build that does not
exist.

## Updates, and why the app will not replace itself

The sidebar checks GitHub's releases once a day and shows every version with its
notes, newest first. Moving between them — in either direction, because a
release that makes a report worse should be undoable without reading a manual —
runs one Homebrew command in Terminal.

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

## Files

| | |
|---|---|
| `SeoAuditApp.swift` | the app, its window and its menu commands |
| `Engine.swift` | starts the CLI, reads its stream, conforms to `AuditEngine` |
| `Report.swift` | the models, and the seam |
| `ContentView.swift` | the window, the session, the stage that morphs |
| `Stages.swift` | asking for a site, and watching it crawl |
| `ReportView.swift` | the report: cause cards, filters, pages |
| `History.swift` | recent sites, and the sidebar |
| `Updates.swift` | releases, versions, and the command that moves between them |
| `VersionsSheet.swift` | every release and what changed in it |
| `PDF.swift` | the report as paper |
