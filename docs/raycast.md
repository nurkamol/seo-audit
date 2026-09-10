# The Raycast extension, from source

The extension is waiting for review in the Raycast Store
([raycast/extensions#30488](https://github.com/raycast/extensions/pull/30488)).
Until it is listed there you can run it from this repository. It is the same
code the Store will ship, on macOS or on Windows, and it takes about two minutes.

Once it is in the Store, install it from there and remove this copy. You would
otherwise have two extensions with the same three commands.

## What you need

- **Raycast.** On macOS, or [Raycast for Windows](https://www.raycast.com/windows),
  which is in beta.
- **Node 22.22 or newer.** It is what the current Raycast build tools ask for.
  Check with `node -v`.
  - macOS: `brew install node`, or `nvm install 22`.
  - Windows: `winget install OpenJS.NodeJS.LTS`, or the installer from
    [nodejs.org](https://nodejs.org). Open a new terminal afterwards so `node`
    is on the path.
- **Git**, to clone the repository. On Windows, `winget install Git.Git`.

You do not need a Raycast account or a developer account. Signing in only
matters for publishing.

## Install

The commands are the same in Terminal on macOS and in PowerShell on Windows:

```bash
git clone https://github.com/nurkamol/seo-audit.git
cd seo-audit/raycast
npm install
npm run dev
```

`npm run dev` builds the extension, opens Raycast and adds three commands:
**Preview Site**, **Audit Site** and **Recent Reports**. Search Raycast for
"SEO Audit" to find them.

Stop it with `Ctrl+C` when you are done. **The extension stays in Raycast after
you stop it**, so you only run `npm run dev` again to update it.

`npm install` gets the audit engine from npm as `@nurkamol/seo-audit`, which is
the package the Store build uses. You do not need anything else from the rest of
the repository.

## Update

```bash
cd seo-audit
git pull
cd raycast
npm install
npm run dev
```

Stop it with `Ctrl+C` once Raycast shows the new version.

## Remove

Remove **SEO Audit** under **Extensions** in Raycast's settings, then delete the
folder you cloned.

## On Windows

It is the same extension with the same commands. A few things are different:

| | macOS | Windows |
|---|---|---|
| Export (HTML, Markdown, CSV, JSON, sitemap) | `⌘E` | `Ctrl+E` |
| Copy a finding's check id | `⌘.` | `Ctrl+.` |
| Copy the whole report as JSON | `⌘⇧C` | `Ctrl+Shift+C` |
| Extension preferences | `⌘,` | `Ctrl+,` |
| Where exports are written | `~/Downloads` | `%USERPROFILE%\Downloads` |
| Where **Recent Reports** reads from | `~/Library/Application Support/seo-audit` | `%APPDATA%\seo-audit` |
| The desktop app it can open | `SEO Audit.app` | `SEO Audit`, from the [releases page](https://github.com/nurkamol/seo-audit/releases) |

**Recent Reports** lists the runs the desktop app has kept. It reads the same
folder the app writes, so a crawl you finish in the app shows up there
straight away. If you have not installed the app, the list is empty. Use
**Audit Site** instead.

Windows support is new. If something on Windows does not work the way this page
describes, please [open an issue](https://github.com/nurkamol/seo-audit/issues)
and say which Raycast version you are on.

## Optional: performance and Search Console

Both are off by default, and are turned on in the extension's preferences.

- **Performance** asks Google's PageSpeed Insights. It works without a key but
  runs into Google's rate limit quickly. To add a key, put `PSI_API_KEY=…` in
  `~/.config/seo-audit/.env`. On Windows that file is
  `%USERPROFILE%\.config\seo-audit\.env`.
- **Search Console** needs you to sign in once from a terminal:
  `npx @nurkamol/seo-audit --search-console-login`. See
  [search-console.md](search-console.md) for creating the OAuth client first.
  If it is turned on without credentials, the report lists what is missing.

## If it does not start

- **`npm run dev` fails with an engine or Node version error.** Your Node is
  older than 22.22. Upgrade it, then run `npm install` again.
- **`ray` is not recognised.** Run `npm install` in the `raycast` folder first.
  The Raycast command-line tool comes with it, and `npm run dev` runs it from
  there.
- **An audit stops with "Command Out of Memory".** Raycast gives each command a
  limited amount of memory, which is why the page limit is capped at 40. Big
  sites belong in the desktop app or the terminal:
  `npx @nurkamol/seo-audit example.com`.
