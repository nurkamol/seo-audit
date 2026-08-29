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
- **The child is killed with the window.** A server that outlives the window
  that opened it holds its port against the next launch. That bug shipped once
  on macOS; there is a test for it here in the sense that it is the one thing
  worth checking by hand after any change to `Engine`.
- **A failure is a window, not a stream.** An app that opens and does nothing
  is the worst version of this, and it is the one that shipped on macOS.

## What it must never grow

A control. Anything this is tempted to draw itself would exist on Windows and
not on macOS, and the rule that keeps five front ends honest is that none of
them re-implements anything. New UI belongs in the served HTML, where every
platform gets it at once.

## Not done yet

Phase 1 is the shell. Still to come: window furniture (menu, native save
dialogs, external links), packaging with a bundled Node, updates, and the
release wiring. `desktop/src-tauri/tauri.conf.json` already names the three
bundle targets; nothing has been built with them.

## A note on running it

`npm run dev` is the supported way. The binary under `target/debug` can be run
directly, but in a dev build the Tauri CLI serves `ui/` rather than embedding
it, so the fallback page renders blank when the binary is launched on its own.
That is a development artifact, not a bug — a release build embeds it.
