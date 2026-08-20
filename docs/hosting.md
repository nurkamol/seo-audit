# Hosting it yourself — what it costs, and what you are taking on

There are two ways to run this. The first is free and is the one to use.

```bash
npx github:nurkamol/seo-audit@v1 https://example.com
```

Nothing to install, nothing to sign up for, no account, no bill, and every
check works. **If you are unsure which you want, it is this one.**

The second is a small web page you deploy to your own Cloudflare account, so a
colleague can audit a site by filling in a form instead of opening a terminal.
It runs the same code and produces the same report. It also costs money, has
limits the CLI does not, and is a crawler with a public address once it is
live — which is what the rest of this page is about.

---

## The short version

| | Local CLI | Hosted on Workers |
|---|---|---|
| Cost | free | **$5/month minimum**, on your card |
| Works on Cloudflare's free plan | — | **no** |
| Certificate expiry checks | yes | no — see below |
| PageSpeed Insights (`--psi`) | yes | not offered — see below |
| Pages per run | 200 by default, no ceiling | 150 by default, ~1,000 ceiling |
| Who is responsible for what it crawls | you, on your own machine | you, on your account |

**Everything below is at your own risk.** This project is MIT licensed and, in
the words of the licence, comes "without warranty of any kind." Deploying it
creates resources on *your* Cloudflare account, billed to *your* payment
method, under *your* agreement with Cloudflare — not with this project or its
author. Nobody here can see your bill, cap it, or refund it. Check the
[current Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
before you deploy, because the numbers on this page were written on
2026-08-21 and Cloudflare's are the ones that count.

---

## Why the free plan cannot run this

Not "runs slowly" — cannot run. Two [platform limits](https://developers.cloudflare.com/workers/platform/limits/)
decide it:

| | Free | Paid |
|---|---|---|
| CPU per invocation | **10 ms** | 30 s (raisable to 5 min) |
| Outbound fetches per invocation | **50** | 10,000 |

An audit of 150 pages makes roughly 450 outbound fetches and spends a few
seconds of CPU parsing HTML. On the free plan it would run out of fetches at
about **16 pages** — and it would never get that far, because parsing a single
page costs more than 10ms of CPU.

Sixteen pages is the failure this tool exists to point at. It is not worth
shipping a hosted mode that does it, so the honest statement is: **the hosted
version needs the $5/month Workers Paid plan.** The CLI does not, and never
will.

## What it costs once you are on the paid plan

The good news, and the reason this is worth offering at all: **Cloudflare does
not bill for the outbound fetches a Worker makes.** The crawl — the expensive
part of the work — is free. You are billed for the one incoming request that
started it, and for CPU.

Workers Paid, as of 2026-08-21: **$5/month**, including 10 million requests
and 30 million CPU-milliseconds. Past that, $0.30 per million requests and
$0.02 per million CPU-milliseconds.

A 150-page audit is 1 request and, by measurement of the same work running
locally, on the order of 4 seconds of CPU. That is an estimate for Workers
rather than a reading from it — Cloudflare's own dashboard will tell you the
real figure after your first few runs, and it is the number to trust.

On that estimate:

- Roughly **7,000 audits a month** fit inside the included allowance.
- Past that, an audit costs about **$0.0001** — a hundredth of a cent.
- An hourly cron against one site is 720 runs a month, comfortably inside it.

So in practice the bill is **$5/month, flat**, unless you are running this
hundreds of times a day. If you are, the CPU line is still cents.

**But: $5/month is a recurring charge that does not stop when you stop using
it.** It stops when you cancel the Workers Paid plan in your Cloudflare
dashboard. Deleting the Worker does not cancel the plan. This is the single
most likely way this costs you money you did not mean to spend — a Worker you
forgot, on a subscription you forgot, for a report you ran once.

## The part that is not about money

**A deployed instance is a crawler with a public URL.** Left open, anyone who
finds it can make your account fetch several hundred pages of any site they
name. The money is not the problem there — a thousand abusive runs is a few
dollars of CPU. The problem is that the traffic comes from your account, and
being the origin of a large unwanted crawl is how you end up in someone's
abuse report and in Cloudflare's.

Two things stand between you and that, and both are on by default:

1. **`AUDIT_TOKEN`.** The Worker refuses to audit anything until this secret is
   set, and says so on every page. This is not a warning you can dismiss; it is
   the deployed behaviour.

   ```bash
   npx wrangler secret put AUDIT_TOKEN
   ```

   Or: **Workers & Pages → your Worker → Settings → Variables and Secrets →
   Add → Secret**, named `AUDIT_TOKEN`.

2. **`ALLOWED_HOSTS`.** Set it to your own domains and the form will refuse
   every other host, so a leaked password is a nuisance rather than an
   incident. It is empty by default, which means "any host". Setting it is the
   difference between a tool and an open crawler.

Also worth knowing: the deployment serves `robots.txt` with `Disallow: /` and
marks every page `noindex`, so neither the form nor a report about someone's
site should end up in a search index. That is a courtesy, not a guarantee —
anything on a public URL can be shared.

## What the hosted version cannot do

**Certificate expiry.** `tls-expiring` and `tls-expired` need a TLS socket
whose peer certificate can be read, and the Workers runtime does not offer one
— `node:tls` is only
[partially supported](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
and this is one of the missing parts.

Rather than let that check fail quietly, every hosted report carries a note
saying the certificate was not checked. A missing finding reads exactly like a
passing one, and a report that is silently two checks shorter than the CLI's is
worse than no report.

**Config files, baselines and diffs.** `--config`, `--baseline`, `--against`
and `--redirects` all read files from disk. The hosted form has no disk. If you
want a baseline diff, run the CLI, or use the GitHub Action.

**PageSpeed Insights.** The form does not offer `--psi`. It is not a runtime
limitation — the Worker could call Google perfectly well — but each measured
page takes about twelve seconds of waiting, and a form that appears to hang for
a minute is a form people stop trusting. Run `--psi` from the CLI, where the
progress is on screen and the wait is obviously yours.

**Very large sites.** `MAX_PAGES` defaults to 150 and the form cannot raise it.
The real ceiling is CPU per invocation: about 25ms per page against a 30-second
budget is somewhere near a thousand pages, and past that you would also need

```jsonc
"limits": { "cpu_ms": 300000 }
```

in `wrangler.jsonc`, up to Cloudflare's 5-minute maximum. A site that big is a
better fit for the CLI, which has no such ceiling and costs nothing.

## Before you decide

Three questions worth asking, because two of the three answers are "you do not
need this":

1. **Do you have a GitHub repository?** Then use the
   [GitHub Action](../README.md#in-ci). It is free, it runs on a
   schedule, it comments on pull requests, and it has no ceiling on pages. Note
   that deploying to Cloudflare requires a GitHub or GitLab account anyway —
   the deploy flow clones this repository into it.
2. **Is it only you?** Then use the CLI. It is one command, it is free, and it
   runs every check including the two the hosted version cannot.
3. **Do you need people who will not open a terminal to run audits themselves?**
   That is the case the hosted version is for. It is a real case. It is also
   the only one.

## Deploying

Requires a Cloudflare account on the **Workers Paid** plan, and a GitHub or
GitLab account for the deploy flow to clone into.

Either the button in the README, or:

Wrangler itself needs Node 22 or newer, even though the CLI runs on 18.

```bash
git clone https://github.com/nurkamol/seo-audit
cd seo-audit
npx wrangler deploy
npx wrangler secret put AUDIT_TOKEN     # required; it will not audit without one
```

Then open the URL wrangler prints, enter the password, and audit something.

## Turning it off

In this order, because the first step alone does not stop the charge:

1. **Cancel the plan** — Cloudflare dashboard → Workers & Pages → Plans →
   downgrade to Free. **This is the step that stops the $5/month.**
2. Delete the Worker — Workers & Pages → your Worker → Settings → Delete. Or
   `npx wrangler delete`.

Deleting the Worker while leaving the plan active keeps the subscription
running for nothing at all.
