# Testing the Raycast extension on Windows

Thank you for trying this. The SEO Audit extension for Raycast was built on a
Mac, and it has now been changed to run on Raycast for Windows too. **Nobody has
run it on Windows yet.** You would be the first, and anything that looks wrong
is worth reporting, even if it seems small.

It takes about 30 minutes. You need no SEO knowledge. Each test says what to do
and what you should see. When what you see is different, write it down.

---

## Before you start

You need:

- **Windows 10 or 11.**
- **Raycast for Windows**, from [raycast.com/windows](https://www.raycast.com/windows).
  Install it and open it once so it is running.
- **Node 22.22 or newer.** Open **PowerShell** and run:

  ```powershell
  node -v
  ```

  If it says `v22.22.0` or higher (`v24…` is fine too), you are set. If it says
  something lower, or that `node` is not recognised, install it:

  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```

  Then **close PowerShell and open a new one**, so it can find `node`.
- **Git.** Check with `git --version`. If it is missing:

  ```powershell
  winget install Git.Git
  ```

  Then open a new PowerShell again.

**Write these down now.** They go at the top of your report:

| | |
|---|---|
| Windows version | Press `Win+R`, type `winver`, press Enter |
| Raycast version | In Raycast's settings, under **About** |
| Node version | `node -v` |

---

## Install

In PowerShell, run these one at a time:

```powershell
cd $HOME
git clone https://github.com/nurkamol/seo-audit.git
cd seo-audit\raycast
npm install
npm run dev
```

`npm install` takes a minute or two. It may print warnings about
"vulnerabilities" or "deprecated" packages. Those are normal and you can ignore
them.

`npm run dev` builds the extension and adds it to Raycast. **Leave that
PowerShell window open while you test.** If anything goes wrong, errors appear
there, and the text is the most useful thing you can send back.

---

## The tests

Open Raycast with its shortcut (`Alt+Space` by default) for each test.

Each test has a number. Use the number in your report.

### 1. The extension is installed

1. Open Raycast and type `SEO Audit`.

**You should see** three commands: **Preview Site**, **Audit Site** and
**Recent Reports**.

### 2. Preview a site with a sitemap

1. Choose **Preview Site**.
2. Type `fitculturepilates.com` and wait a few seconds.

**You should see:**
- A first row like `33 URLs listed`, with `25 would be checked · 8 past the
  limit of 25` beside it. The numbers change as the site changes.
- Rows naming parts of the site with a count each, such as `/locations/` and
  `5 URLs`.
- A last row like `6 requests, 6.1s` saying `No page was fetched`. Anything up
  to about ten seconds is fine.

### 3. Preview a site with no sitemap

1. Still in **Preview Site**, clear the text and type `example.com`.

**You should see** a row saying **No sitemap**, and that links would be followed
from the home page instead.

### 4. Preview something that is not a site

1. Clear the text and type `this-does-not-exist-12345.com`.

**You should see** a message saying it could not look, or that nothing
answered. It should not look like a normal result, and it should not crash.

### 5. Ctrl+, opens the extension's preferences

1. Type `fitculturepilates.com` again and wait for the rows.
2. Press `Ctrl+,`.

**You should see** the extension's preferences open, starting with **Pages per
run**. Close them without changing anything.

> This is one of the things most likely to be broken. The shortcut used to
> exist only on the Mac. If `Ctrl+,` does nothing, say so.

### 6. Run an audit

1. Go back to the **Preview Site** result for `fitculturepilates.com`.
2. Press `Enter` on any row. The first action is **Audit This Site**.

**While it runs, you should see** a count like `7 of at most 25 pages`, going
up. This takes up to a minute or two.

**When it finishes, you should see:**
- A **Score** row at the top, like `84/100 B`.
- Groups of findings under headings like **Metadata** or **Links**. Each has a
  red, orange or blue icon and a number on the right, which is how many pages
  are affected.
- Further down: **Hosts on fitculturepilates.com**, **Passing** and **Not
  Checked**.

Write down the score and roughly how long it took.

### 7. The shortcuts on a finding

Select any finding in the audit from test 6. Do each of these and note what
happens:

| Press | You should see |
|---|---|
| `Ctrl+.` | Nothing visible, but the check's id is copied. Open Notepad and paste (`Ctrl+V`): you should get something short like `desc-long`. |
| `Ctrl+Shift+C` | The whole report is copied as JSON. Paste it into Notepad: it is long text starting with `{`. |
| `Ctrl+E` | A menu called **Export…** with seven choices, starting with **HTML report**. Press `Esc` to close it for now. |

Also open the action menu (in Raycast for Windows that is usually `Ctrl+K`) and
check that each action shows the shortcut above next to it. **If a shortcut
shows `⌘` (the Mac Command key) instead of `Ctrl`, or shows nothing, write it
down.**

### 8. Export the report

1. On a finding, press `Ctrl+E`, then choose **HTML report**.

**You should see** a message saying `Wrote HTML report`, with a path like:

```
C:\Users\<you>\Downloads\seo-audit-fitculturepilates.com-2026-09-11.html
```

2. The message has two buttons. Try both:
   - **Show in Explorer** should open File Explorer with the file selected.
     **If the button says "Show in Finder", that is a bug.**
   - **Open** should open the report in your browser.

3. Do the same for **Markdown**, **Spreadsheet (CSV)**, **JSON**, **llms.txt**
   and **Structured data**. Each should write a file to Downloads.

4. Try **Corrected sitemap**. This one will probably say **Not written**, with a
   reason about the crawl not seeing the whole site. That is correct: it
   refuses to write a sitemap from a partial crawl. Note the reason it gives.

### 9. Run again with a skipped check

1. In the audit from test 6, scroll down to **Not Checked**.
2. Look for a row with a blue play icon and a tag like `--check-external` or
   `--psi`.
3. Press `Enter` on it (**Run Again with This Check**).

**You should see** the audit start again from zero and finish with that row
gone from **Not Checked**.

### 10. Change a preference

1. Open **Preview Site**, type `fitculturepilates.com`, press `Ctrl+,`.
2. Set **Pages per run** to `5` and **Speed** to **Gentle — 1 connection**.
3. Run an audit again (from Preview, **Audit This Site**).

**You should see** `of at most 5 pages` while it runs.

4. Put **Pages per run** back to `25` and **Speed** back to **Normal**.

### 11. Recent Reports, without the desktop app

Skip this one if you already have the **SEO Audit** desktop app installed.

1. Open **Recent Reports**.

**You should see** **Nothing kept yet**, with a line saying the SEO Audit
desktop app keeps every finished run. It should not mention macOS.

### 12. Recent Reports, with the desktop app

This needs the desktop app. It is optional, but it tests the part of the change
that is most likely to be wrong on Windows.

1. Download the file ending in `_x64-setup.exe` from the
   [releases page](https://github.com/nurkamol/seo-audit/releases/latest) and
   install it. Windows may warn that it is from an unknown publisher; choose
   **More info → Run anyway**.
2. Open the app, audit `fitculturepilates.com` in it, and wait for it to
   finish.
3. In PowerShell, run these two commands and copy the output into your report:

   ```powershell
   Get-ChildItem "$env:APPDATA\seo-audit"
   Get-ChildItem "$env:LOCALAPPDATA\SEO Audit" -ErrorAction SilentlyContinue
   ```

   The first shows where the app keeps its runs. The second shows where it was
   installed.
4. In Raycast, open **Recent Reports**.

**You should see** the run you just did in the app, with its score and when it
ran.

5. Press `Enter` on it. **You should see** the same findings the app showed.
6. Go back, open the action menu on the run (`Ctrl+K`) and check for:
   - **Open the SEO Audit App.** It should launch the desktop app. **If this
     action is missing, that is a bug.** It means the extension could not find
     where the app was installed, and the output from step 3 is what's needed to
     fix it.
   - **Show the JSON.** It should open File Explorer at a `.json` file inside
     `%APPDATA%\seo-audit\reports`.

### 13. The page limit

1. In preferences, set **Pages per run** to `40`.
2. Audit a larger site you know, such as a news site or a big blog.

**You should see** it finish with a report. If it stops with **Command Out of
Memory**, note which site and how far it got. That is a known limit on Mac, and
this checks whether Windows has the same one.

3. Put **Pages per run** back to `25`.

### 14. The extension stays installed

1. In the PowerShell window running `npm run dev`, press `Ctrl+C` to stop it.
2. Open Raycast and type `SEO Audit`.

**You should see** the three commands still there, and **Preview Site** should
still work.

---

## Anything else

Please also note anything that looks off, even if no test mentions it:

- Text that says **Mac**, **macOS**, **Finder** or **⌘**, anywhere.
- Icons that are missing or look broken.
- Anything slow, frozen, or that showed an error screen.
- Anything you expected to be able to do and could not.

---

## How to report

Copy this, fill it in, and send it back. For anything that failed, a screenshot
helps (`Win+Shift+S` takes one).

```markdown
Windows version:
Raycast version:
Node version:

| Test | Result | Notes |
|------|--------|-------|
| 1  Installed               | pass / fail | |
| 2  Preview with sitemap    | pass / fail | |
| 3  Preview, no sitemap     | pass / fail | |
| 4  Preview, not a site     | pass / fail | |
| 5  Ctrl+, preferences      | pass / fail | |
| 6  Audit                   | pass / fail | score: , took: |
| 7  Shortcuts               | pass / fail | Ctrl+. / Ctrl+Shift+C / Ctrl+E |
| 8  Export                  | pass / fail | Show in Explorer? Sitemap reason: |
| 9  Run again               | pass / fail | |
| 10 Preferences             | pass / fail | |
| 11 Recent, no app          | pass / fail / skipped | |
| 12 Recent, with app        | pass / fail / skipped | |
| 13 Page limit              | pass / fail | site: |
| 14 Stays installed         | pass / fail | |

Anything else:

Output of the two PowerShell commands from test 12:

Errors from the npm run dev window (if any):
```

---

## Removing it afterwards

1. In Raycast's settings, go to **Extensions**, find **SEO Audit** and remove it.
2. Delete the folder: `Remove-Item -Recurse -Force $HOME\seo-audit`
3. Exported reports are in your Downloads folder, named `seo-audit-…`. Delete
   them if you like.
4. If you installed the desktop app for test 12, uninstall it from **Settings →
   Apps**.
