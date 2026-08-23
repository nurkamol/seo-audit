#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { audit } from '../src/audit.mjs';
import { terminal, markdown, html, diffReport, counts, portfolio, portfolioMarkdown, portfolioHtml, progressLine } from '../src/report.mjs';
import { loadConfig, resolveSites, optionsForSite } from '../src/config.mjs';
import { readFileSync as read } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serialize, parse, diff } from '../src/baseline.mjs';
import { parseRedirectMap } from '../src/redirects.mjs';
import { askForSite, isInteractive, invocation } from '../src/prompt.mjs';
import { userAgentFor, BROWSER_NAMES, OS_NAMES, thisPlatform } from '../src/agents.mjs';

const HELP = `
  seo-audit — crawl a site's sitemap and check every page

  Usage
    npx github:nurkamol/seo-audit <url> [more urls…] [options]

  Name more than one site — or list them under "sites" in the config — and the
  report becomes a portfolio table, one row per site, worst first.

  Reporting
    --md <file>        write a Markdown report
    --html <file>      write a self-contained HTML report (one file, no assets)
    --json <file>      write a JSON report (also usable as a baseline)
    --quiet            print nothing; rely on the exit code and the files
    --verbose          print each request as it happens, to stderr. A long
                       crawl is otherwise silent from start to finish, and a
                       slow site looks exactly like a hung one

  Comparing
    --baseline <file>  compare against a previous --json run and show only
                       what changed. With --fail-on new, a build fails on a
                       regression but tolerates findings you already knew about
    --update-baseline  write the baseline file after comparing
    --against <url>    compare against another deployment right now — a
                       preview against production, say. Hosts are ignored, so
                       only genuine differences show up

  Crawling
    --settle <seconds> wait until the site serves consistent HTML before
                       crawling. A CDN rolls a deploy out unevenly, and a crawl
                       during that window is wrong in a confusing way
    --limit <n>        maximum pages to check (default 200)
    --concurrency <n>  parallel requests (default 6)
    --sitemap <url>    sitemap location, if not declared in robots.txt
    --redirects <file> a migration's redirect map (Netlify _redirects shape:
                       "/old /new 301" per line). Every old URL is asked for,
                       and what actually happens is reported
    --check-external   also check links pointing off the site. Off by default:
                       other people's servers rate-limit and bot-block, so only
                       a 404, a 410 or no answer at all is ever reported
    --serve [port]     open the same form the hosted version serves, on this
                       machine (default 4321). No account, no bill, and none of
                       the limits a Worker has — the crawl is only bounded by
                       what this computer will do
    --browser <name>   crawl as a real browser or a search crawler:
                       ${BROWSER_NAMES.join(', ')}.
                       Googlebot is what Google is served; a browser is what a
                       host blocking crawlers will answer
    --os <name>        the system that browser is running on, default this one:
                       ${OS_NAMES.join(', ')}
    --search-console [property]
                       order findings by what the pages actually do in Google.
                       Needs GSC_CLIENT_ID, GSC_CLIENT_SECRET and
                       GSC_REFRESH_TOKEN in the environment or in
                       ~/.config/seo-audit/.env. A domain property is named
                       "sc-domain:example.com" rather than by its URL
    --compare-as <name> fetch a sample of pages a second time as this browser
                       or crawler and report what changed. A page that differs
                       with the reader is cloaking, or bot protection misfiring
    --user-agent <ua>  identify as something else. Some hosts stall clients
                       that do not look like a browser

  Filtering
    --config <file>    default: seo-audit.config.json in the working directory
    --ignore <ids>     comma-separated check ids to silence for this run

  Performance (asks Google, does not guess)
    --psi <urls>       comma-separated pages to measure with PageSpeed
                       Insights. Slow (~12s each) and rate-limited, so name a
                       handful. A path glob names a section — /journal/** is
                       every crawled page under it, sampled. Uses PSI_API_KEY,
                       or ~/.config/seo-audit/.env
    --psi-sample <n>   pages to measure per section glob (default 3). The
                       report says what was matched but not measured
    --psi-strategy     mobile (default) | desktop

  Exit code
    --fail-on <level>  error (default) | warn | new | never
                       "new" needs --baseline

  Examples
    npx github:nurkamol/seo-audit https://example.com
    npx github:nurkamol/seo-audit https://example.com --md audit.md
    npx github:nurkamol/seo-audit https://example.com \\
      --baseline seo-baseline.json --fail-on new
    npx github:nurkamol/seo-audit one.example two.example --html portfolio.html

  Correctness is checked on every page. Performance is never estimated — with
  --psi it is measured by Google, and otherwise left to pagespeed.web.dev.
`;

function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg === '--against') opts.against = value();
    else if (arg === '--settle') opts.settle = Number(value());
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '--md') opts.md = value();
    else if (arg === '--html') opts.html = value();
    else if (arg === '--json') opts.json = value();
    else if (arg === '--baseline') opts.baseline = value();
    else if (arg === '--update-baseline') opts.updateBaseline = true;
    else if (arg === '--limit') opts.limit = Number(value());
    else if (arg === '--concurrency') opts.concurrency = Number(value());
    else if (arg === '--sitemap') opts.sitemap = value();
    else if (arg === '--redirects') opts.redirects = value();
    else if (arg === '--check-external') opts.checkExternal = true;
    else if (arg === '--user-agent') opts.userAgent = value();
    else if (arg === '--serve') {
      // The port is optional: --serve on its own, or --serve 8080.
      const next = argv[i + 1];
      opts.serve = next && /^\d+$/.test(next) ? Number(argv[++i]) : true;
    }
    else if (arg === '--search-console') {
      // Optionally the property name, since a domain property is not a URL.
      const next = argv[i + 1];
      opts.searchConsole = next && !next.startsWith('--') ? argv[++i] : true;
    }
    else if (arg === '--compare-as') opts.compareAs = value();
    else if (arg === '--compare-sample') opts.compareSample = Number(value());
    else if (arg === '--browser') opts.browser = value();
    else if (arg === '--os') opts.os = value();
    else if (arg === '--config') opts.config = value();
    else if (arg === '--ignore') opts.ignore = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--fail-on') opts.failOn = value();
    else if (arg === '--psi') opts.psi = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--psi-sample') opts.psiSample = Number(value());
    else if (arg === '--psi-strategy') opts.psiStrategy = value();
    else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    } else rest.push(arg);
  }
  opts.target = rest[0];
  opts.targets = rest;
  return opts;
}

const cli = parseArgs(process.argv.slice(2));

if (cli.version) {
  const here = dirname(fileURLToPath(import.meta.url));
  console.log(JSON.parse(read(join(here, '..', 'package.json'), 'utf8')).version);
  process.exit(0);
}

if (cli.help) {
  console.log(HELP);
  process.exit(0);
}

let file;
try {
  file = loadConfig(cli.config);
} catch (err) {
  console.error(`  ${err.message}`);
  process.exit(2);
}

// A `psi: ["/", "/journal/**"]` in the config is written as paths and globs.
// Both are resolved against the crawled site later, in src/psi.mjs, which knows
// the origin the audit actually settled on and can match a glob against the
// pages that were really found.
const psiFromConfig = file.psi ?? [];

// CLI wins over the config file; ignore rules from both are combined, since
// one is "this site always" and the other is "just this run".
const opts = {
  ...file,
  ...Object.fromEntries(Object.entries(cli).filter(([, v]) => v !== undefined)),
  ignore: [...(file.ignore ?? []), ...(cli.ignore ?? [])],
  psi: cli.psi ?? (psiFromConfig.length ? psiFromConfig : undefined),
  failOn: cli.failOn ?? file.failOn ?? 'error',
};

// A browser or a crawler to present as, resolved once and refused loudly. An
// impossible pair describes a machine that does not exist, and the whole point
// of the flag is to be believed by a server.
if (opts.browser) {
  const { ua, error, ignoredOs } = userAgentFor(opts.browser, opts.os ?? thisPlatform());
  if (error) {
    console.error(`  ${error}`);
    process.exit(2);
  }
  if (ignoredOs) {
    console.error(`  --os is ignored for ${opts.browser}: a crawler's user agent names no machine.`);
  }
  // An explicit --user-agent is a literal string and outranks a preset.
  opts.userAgent = opts.userAgent ?? ua;
} else if (opts.os) {
  console.error('  --os needs --browser: it says which system the browser is running on.');
  process.exit(2);
}

// The second reader, resolved the same way as the first and refused as loudly.
if (opts.compareAs) {
  const { ua, error } = userAgentFor(opts.compareAs, opts.os ?? thisPlatform());
  if (error) {
    console.error(`  ${error}`);
    process.exit(2);
  }
  opts.compareAs = { ua, label: opts.compareAs };
}

if (opts.failOn === 'new' && !opts.baseline) {
  console.error('  --fail-on new needs --baseline <file> to compare against.');
  process.exit(2);
}

// Read the redirect map once, here, so a portfolio does not re-read it per site
// and a missing file fails before anything is crawled.
if (opts.redirects) {
  if (!existsSync(opts.redirects)) {
    console.error(`  Redirect map not found: ${opts.redirects}`);
    process.exit(2);
  }
  opts.redirectRules = parseRedirectMap(readFileSync(opts.redirects, 'utf8'));
  if (!opts.redirectRules.length) {
    console.error(`  ${opts.redirects} has no rules in it.`);
    process.exit(2);
  }
}

// Live progress, on stderr so it never contaminates a piped report. --quiet
// wins over --verbose: asking for silence and getting a running commentary
// would be the more surprising of the two.
const live = (origin) =>
  opts.verbose && !opts.quiet
    ? (event) => process.stderr.write(`${progressLine(event, origin)}\n`)
    : undefined;

// One site or twenty: the same options, resolved the same way. A site entry in
// the config may carry its own overrides, which land on top of the shared ones.
let sites = resolveSites(cli.targets ?? [], file);

// The local UI, which is a different program from here on: no target, no
// report file, and it runs until interrupted.
if (opts.serve) {
  const { serve } = await import('../src/serve.mjs');
  const { url } = await serve({
    port: opts.serve === true ? 4321 : opts.serve,
    maxPages: opts.limit,
    userAgent: opts.userAgent,
  });
  console.log(`\n  seo-audit is serving at ${url}\n  Nothing leaves this machine. Ctrl-C to stop.\n`);

  // Started by something rather than by somebody: when stdin is a pipe, its
  // closing is the parent going away, and a server that outlives the window
  // that opened it holds the port against the next launch. A terminal gives a
  // TTY instead, where Ctrl-C is the way out and this must not fire.
  if (!process.stdin.isTTY) {
    process.stdin.resume();
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('close', () => process.exit(0));
  }
} else {

// Nothing to audit. If a person is there to ask, ask; otherwise this is a
// script or a CI runner and the help text is the right answer.
if (!sites.length) {
  let answers = null;
  if (isInteractive()) {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('');
    answers = await askForSite(rl);
    rl.close();
  }

  if (!answers) {
    console.log(HELP);
    process.exit(2);
  }

  sites = resolveSites([answers.url], file);
  if (answers.html) opts.html = answers.html;
  console.log(`\n  Next time, in one line:\n    ${invocation(sites[0].url, answers)}\n`);
}

for (const site of sites) {
  try {
    new URL(site.url);
  } catch {
    console.error(`Not a URL: ${site.url}`);
    process.exit(2);
  }
}

// --- A portfolio ---------------------------------------------------------
if (sites.length > 1) {
  // Comparing two deployments, or against a stored baseline, is a question
  // about one site. Rather than half-answer it across twenty, say so.
  for (const [flag, name] of [['baseline', '--baseline'], ['against', '--against'], ['updateBaseline', '--update-baseline']]) {
    if (opts[flag]) {
      console.error(`  ${name} audits one site at a time — it compares a site against itself.`);
      console.error(`  Run it per site, or drop the flag to get the portfolio table.`);
      process.exit(2);
    }
  }

  const runs = [];
  for (const [i, site] of sites.entries()) {
    if (!opts.quiet) process.stderr.write(`  [${i + 1}/${sites.length}] ${site.url} …\n`);
    const siteOpts = optionsForSite(opts, site.overrides);
    // Sites run one at a time on purpose: interleaved progress from twenty
    // hosts is unreadable, and each audit is already parallel internally.
    const { findings, meta } = await audit(site.url, {
      ...siteOpts,
      onNote: (m) => !opts.quiet && process.stderr.write(`      ${m}\n`),
      onProgress: live(site.url),
    });
    runs.push({ findings, meta });
  }

  if (!opts.quiet) console.log(portfolio(runs));
  if (opts.md) writeFileSync(opts.md, portfolioMarkdown(runs));
  if (opts.html) writeFileSync(opts.html, portfolioHtml(runs));
  if (opts.json) {
    writeFileSync(
      opts.json,
      JSON.stringify(
        { tool: 'seo-audit', date: runs[0]?.meta.date, sites: runs.map((r) => ({ ...r.meta, findings: r.findings })) },
        null,
        2,
      ),
    );
  }
  if (!opts.quiet && (opts.md || opts.html || opts.json)) {
    console.log(`  ${[opts.md, opts.html, opts.json].filter(Boolean).join('  ')}\n`);
  }

  // One bad site fails the run: a portfolio check that passes while a site in
  // it is broken is a check nobody can trust.
  const failed = runs.some(({ findings }) => {
    const n = counts(findings);
    return (opts.failOn === 'error' && n.error > 0) || (opts.failOn === 'warn' && n.error + n.warn > 0);
  });
  process.exit(failed ? 1 : 0);
}

const target = sites[0].url;

if (!opts.quiet) {
  process.stderr.write(`  crawling ${target} …${file.source ? ` (${file.source})` : ''}\n`);
}

if (!opts.quiet && opts.settle) {
  process.stderr.write(`  waiting up to ${opts.settle}s for the site to serve consistent HTML …\n`);
}

const { findings, meta } = await audit(target, {
  ...opts,
  onNote: (m) => !opts.quiet && process.stderr.write(`  ${m}\n`),
  onProgress: live(target),
});

// --- Compare against another deployment, if asked -----------------------
let against = null;
if (opts.against) {
  const reference = /^https?:\/\//i.test(opts.against) ? opts.against : `https://${opts.against}`;
  if (!opts.quiet) process.stderr.write(`  crawling ${reference} to compare …\n`);
  const other = await audit(reference, { ...opts, against: undefined, settle: undefined });
  against = diff({ findings: other.findings, meta: other.meta }, findings, { ignoreHost: true });
  against.previousDate = reference;
}

// --- Compare against a stored baseline, if asked ------------------------
let comparison = against;
if (opts.baseline && !against) {
  if (existsSync(opts.baseline)) {
    try {
      comparison = diff(parse(readFileSync(opts.baseline, 'utf8'), opts.baseline), findings);
    } catch (err) {
      console.error(`  ${err.message}`);
      process.exit(2);
    }
  } else if (!opts.quiet) {
    process.stderr.write(`  no baseline at ${opts.baseline} yet — writing one\n`);
  }
  if (!existsSync(opts.baseline) || opts.updateBaseline) {
    writeFileSync(opts.baseline, serialize(findings, meta));
  }
}

// --- Report -------------------------------------------------------------
if (!opts.quiet) {
  console.log(comparison ? diffReport(comparison) : terminal(findings, meta));
}
if (opts.md) writeFileSync(opts.md, markdown(findings, meta));
if (opts.html) writeFileSync(opts.html, html(findings, meta));
if (opts.json) writeFileSync(opts.json, serialize(findings, meta, { full: true }));
if (!opts.quiet && (opts.md || opts.html || opts.json)) {
  console.log(`  ${[opts.md, opts.html, opts.json].filter(Boolean).join('  ')}\n`);
}

// --- Exit ---------------------------------------------------------------
const n = counts(findings);
const failed =
  (opts.failOn === 'error' && n.error > 0) ||
  (opts.failOn === 'warn' && n.error + n.warn > 0) ||
  (opts.failOn === 'new' && (comparison?.added.length ?? 0) > 0);
process.exit(failed ? 1 : 0);

}
