# The window, on Windows and Linux

A Tauri shell over the same local server the macOS app talks to. It draws
nothing.

```bash
cd desktop
npm install
npm run dev
```

Needs a Rust toolchain — `brew install rustup && rustup toolchain install stable`,
or your platform's equivalent. `npm run test:all` at the repository root runs
the Rust tests along with everything else, and says plainly when it could not.

## What this is

The macOS app was never self-contained: it spawns `bin/seo-audit.mjs` with
`--serve 0`, reads the port off stdout, and talks to it over HTTP. This does
exactly the same thing and points a webview at the result, so Windows and Linux
get the report the browser already renders — sidebar, score ring and all —
inside a real window.

```
Tauri window  →  127.0.0.1:PORT  →  node --serve 0  →  src/*.mjs
   this file        loopback          the sidecar       the checks
```

Only the first box is new. `src/main.rs` is a port of
`mac/SeoAudit/Engine.swift`, including the parts that were only learned by
getting them wrong there:

- **Port zero.** The operating system picks a free one and the server prints
  where it landed. Guessing is how two copies of an app fight over one port.
- **Node by path, not by `PATH`.** A window launched from a dock or a Start
  menu inherits almost none, so looking Node up the obvious way finds nothing
  on a machine that plainly has it.
- **The child dies with the window, however the window dies.** A server that
  outlives the window that opened it holds its port against the next launch —
  a bug that shipped once on macOS. Closing fires `Destroyed` and quitting fires
  `Exit`, and both stop it; nothing fires when a process is terminated outright,
  and on Windows the engine then survived. A job object with
  `KILL_ON_JOB_CLOSE` moves that promise from this code to the kernel. CI kills
  the app the hard way on both platforms to check.
- **A failure is a window, not a stream.** An app that opens and does nothing
  is the worst version of this, and it is the one that shipped on macOS.

## Why the identifier is not the app's

`com.nurkamol.seo-audit.desktop`, where the macOS app is
`com.nurkamol.seo-audit`. They are two programs, and on macOS one identifier is
one `defaults` domain — sharing it would have this shell reading and writing the
app's settings, its update-check timestamps and its dismissed-version list.
Launch Services would also have two apps claiming to be the same one.

macOS is deliberately not in `bundle.targets`: the Swift app is the macOS
release and is better there. If a macOS build of this ever ships alongside it,
it needs a distinct **name** too — both would want `/Applications/SEO Audit.app`.

They do share one thing on purpose: the reports folder. A crawl run in either
window appears in the other's sidebar, because there is one library rather than
two copies of one.

## What it must never grow

A control. Anything this is tempted to draw itself would exist on Windows and
not on macOS, and the rule that keeps five front ends honest is that none of
them re-implements anything. New UI belongs in the served HTML, where every
platform gets it at once.

## The window's furniture

A menu of **File · Edit · Help**, and every item in it is either navigation or a
link. Edit is the predefined one rather than hand-written, because on Linux and
Windows a webview with no Edit menu is a text field where Ctrl-C does nothing —
which is not a thing anybody would think to test.

**External links leave.** A report is full of the audited site's own URLs, and
following one used to replace the report with somebody else's website, inside a
window with no address bar to get out of and holding this app's capabilities.
Now the engine's own origin is the app and everything else opens in a browser.
`is_the_app()` is the whole policy and it is the most-tested function here.

**Saving is not a control this owns.** The seven export formats are links in the
served HTML — `/reports/<id>/export?as=…` — so a plain browser downloads them
and this window inherits the lot without a native dialog or a menu item. That is
the rule working: the feature landed once and every platform got it.

## Packaging

```bash
npm run stage     # stage a Node and the engine, and prove the staged copy runs
npm run build     # bundle for this platform
```

Named `stage` rather than `prepare`, because npm runs a script called
`prepare` on every `npm install` — which would copy 110 MB and shell out to
`rustc` before anything had asked it to, including during `npm ci` in CI where
the toolchain may not be on the path yet.

`scripts/prepare.mjs` copies `process.execPath` to
`src-tauri/binaries/node-<target-triple>` — the name Tauri looks for, asked of
`rustc` rather than worked out, because a name one character off does not fail
loudly, it bundles nothing. The engine itself goes to `src-tauri/engine/`.

Then it **starts the staged copy and waits for it to announce a port.** The
first bundle staged `bin` and `src` and not `worker`, which `--serve` imports,
so it built, installed, launched, spawned its engine and waited fifteen seconds
for an address that was never coming. A list of directories is exactly the kind
of thing that looks right and is not.

What comes out:

| | |
|---|---|
| `SEO Audit_1.34.0_x64-setup.exe` | **23 MB** — NSIS compresses the runtime hard |
| `SEO Audit_1.34.0_amd64.deb` | **45 MB** |
| `SEO Audit_1.34.0_amd64.AppImage` | **115 MB** — uncompressed, which is what a single file costs |

Inside a macOS build, for reference — the layout is the same everywhere and this
is the one that can be inspected on a Mac:

```
115 MB  SEO Audit.app
  ├─ Contents/MacOS/node        110 MB   the sidecar, triple stripped by Tauri
  ├─ Contents/MacOS/seo-audit     3 MB   this shell
  └─ Contents/Resources/engine  0.5 MB   bin, src, worker, package.json
```

macOS is not in `bundle.targets`; that build is only for checking the mechanism
on the machine most likely to be doing the checking — which is how the missing
`worker/` was found.

**What has not been proven:** the Windows and Linux bundles build and their
contents are the right size, and nobody has run one. Neither has the upgrade
path, which is where the sidecar-staleness bug lives.

### The version check

Tauri's NSIS installer has [a reported bug](https://github.com/tauri-apps/tauri/issues/15134)
where a Windows upgrade replaces the main binary and leaves the sidecar behind.
Here the sidecar *is* the engine, so the app would come back looking new and run
the old checks, with nothing on screen to say so — a missing finding reads
exactly like a passing one, and a stale engine is a whole report of them.

So a bundled build asks the engine `--version` before starting it, and refuses
with an explanation if it disagrees with the shell's. Development is exempt: the
checkout is the engine, and whatever the working tree says is what was meant.

## Updates

The macOS app settled the principle: **the thing that installed it is the thing
that replaces it.** That generalises, but not evenly — the platforms differ in
what they let a program do without a password it has no way to ask for.

So there is no single Update button that always works. The shell works out how
this copy got here and offers the one action that is correct for it:

| Installed by | What it offers |
|---|---|
| winget | Runs `winget upgrade` here, then offers to relaunch. A per-user install needs no elevation, which is the same property that makes Homebrew work on macOS |
| apt | Shows the command. `apt` needs root, and a GUI app that shells out to `sudo` is one that hangs on a password prompt nobody can see |
| AppImage · the installer · by hand | Opens the release page |

It deliberately does not download a binary and put it in place itself. Doing
that safely needs a signature to check or a checksum to compare, and an updater
that overwrites an application on the strength of a plain HTTPS response is a
supply-chain hole with a progress bar on it.

The check is once a day, on a thread, after the window is up — an update is
never worth delaying a report for. **Check for Updates…** in the app menu asks
regardless.

It asks GitHub's API and falls back to the Atom feed, because the anonymous API
allows sixty calls an hour **per address**, shared with every other tool on the
machine, and being refused is ordinary. The feed cannot tell a prerelease from a
release, so a version learned there is announced with that said out loud rather
than asserted — the same wording the macOS app uses, for the same reason.

No HTTP client crate: the Node this app already ships has `fetch`, and adding a
TLS stack so a 110 MB bundle can make one request a year is the larger thing,
not the smaller one.

## Not done yet

Phases 1 to 4. Still to come: attaching the bundles to a release, and a winget
manifest — until that exists, no Windows copy is a winget install and the first
row of that table is unreachable. `desktop/src-tauri/tauri.conf.json` already names the three
bundle targets; nothing has been built with them.

## A note on running it

`npm run dev` is the supported way. The binary under `target/debug` can be run
directly, but in a dev build the Tauri CLI serves `ui/` rather than embedding
it, so the fallback page renders blank when the binary is launched on its own.
That is a development artifact, not a bug — a release build embeds it.
