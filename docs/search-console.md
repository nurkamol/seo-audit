# Search Console

Every other ordering in this report is derived from the site's own markup — how
many links point at a page, how far it is from the home page. Those are good
proxies. Impressions are not a proxy: a broken canonical on a page with four
thousand impressions a month is a different sentence from the same canonical on
a page nobody has ever been shown.

This is the only part of the tool that needs an account, and it is entirely
optional. Everything else works without it.

## Setup, once

### 1. Make an OAuth client

In [console.cloud.google.com](https://console.cloud.google.com):

1. Create a project, or pick one you already have.
2. **APIs & Services → Library** → search for **Google Search Console API** →
   **Enable**.
3. **APIs & Services → OAuth consent screen**, if it asks. Choose **External**,
   fill in the three required fields, and add your own Google account under
   **Test users**. Nothing here gets published or reviewed — a test user is
   enough forever.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   Application type: **Desktop app**. Any name.

You get a client ID and a client secret.

> A desktop client secret is not really a secret, and Google says so: any
> installed application necessarily ships one, so it cannot be confidential.
> The security in this flow comes from the loopback redirect and the consent
> screen, not from that string. Keep it out of a repository anyway — habits
> that depend on remembering which secrets matter are the ones that fail.

### 2. Put it where the tool looks

```bash
mkdir -p ~/.config/seo-audit
cat >> ~/.config/seo-audit/.env <<'EOF'
GSC_CLIENT_ID=…apps.googleusercontent.com
GSC_CLIENT_SECRET=…
EOF
chmod 600 ~/.config/seo-audit/.env
```

Deliberately outside any repository. The same file holds `PSI_API_KEY` if you
use `--psi`.

### 3. Sign in

```bash
npx @nurkamol/seo-audit --search-console-login
```

Your browser opens, you sign in, and `GSC_REFRESH_TOKEN` is written to that
same file at mode `600`. It is never printed — a token echoed to a terminal is
a token in a scrollback buffer and probably in a shell history file.

Then it lists what the account can actually read:

```
  Refresh token written to /Users/you/.config/seo-audit/.env

  Properties this account can read:
    sc-domain:example.com  (siteOwner)
    https://www.example.com/  (siteFullUser)

  Try: seo-audit https://example.com --search-console sc-domain:example.com
```

That list is the point of the step. A token that can read nothing looks exactly
like a token that works, right up until an audit reports the property was not
found.

## Using it

```bash
seo-audit https://example.com --search-console sc-domain:example.com
```

Name the property exactly as the list printed it. **A domain property is
`sc-domain:example.com`, not a URL** — this is the single most common reason
the call comes back empty. A URL-prefix property is named by its URL, trailing
slash included.

```
· Search Console has 412 pages for this site
  38 of this crawl's findings are on 22 pages Google has shown, 14,207 times
  over 28 days — out of 61,004 across the whole property.
```

Two numbers, deliberately. The first is the pages this crawl actually reached;
the second is the property. An early version reported the property total as
though it belonged to the crawled pages, which was one sentence joining two
numbers that had nothing to do with each other.

Findings then sort by impressions where Google knows the page, and by how much
of the site links to it where it does not.

## The window it asks for

28 days, ending **three days ago**. Search Console reports its last three days
incompletely, so a window running to today makes a page look like it lost all
its impressions yesterday when it has simply not been counted yet.

## In CI

`--search-console-login` opens a browser, so it is not a GitHub Action input:
a flag CI can accept and never satisfy is worse than no flag. Sign in once on a
machine with a browser, then copy the three values into your CI secrets and
pass them as environment variables.

```yaml
- uses: nurkamol/seo-audit@v1
  with:
    url: https://example.com
    search-console: sc-domain:example.com
  env:
    GSC_CLIENT_ID: ${{ secrets.GSC_CLIENT_ID }}
    GSC_CLIENT_SECRET: ${{ secrets.GSC_CLIENT_SECRET }}
    GSC_REFRESH_TOKEN: ${{ secrets.GSC_REFRESH_TOKEN }}
```

## When it does not work

Every one of these is a note in the report, never a crash. An audit that dies
because an optional integration failed is worse than one that says so, and
everything else in the report is unaffected.

| What the report says | What it means |
|---|---|
| `Search Console was asked for but not configured` | One of the three variables is missing. The note names which. |
| `Search Console did not answer` | Usually the property name — a domain property is `sc-domain:example.com`. It is also what you get if the account cannot read that property. |
| `Google returned no refresh token` | The account has authorised this client before, and Google only issues a refresh token on first consent. Revoke it at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and sign in again. |
| The call works but nothing matches | The URLs Google reports differ from the ones crawled — a `www` mismatch, or `http` against `https`. Check which property you named. |

## What is stored, and where

| | |
|---|---|
| `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET` | `~/.config/seo-audit/.env`, written by you |
| `GSC_REFRESH_TOKEN` | the same file, written by `--search-console-login` at mode `600` |
| Anything else | nothing. No account, no server, no telemetry. The scope requested is read-only. |

Revoke access at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions);
the tool degrades to a note and keeps working.
