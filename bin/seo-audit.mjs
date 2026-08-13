#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { audit } from '../src/audit.mjs';
import { terminal, markdown, html, diffReport, counts } from '../src/report.mjs';
import { loadConfig } from '../src/config.mjs';
import { readFileSync as read } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serialize, parse, diff } from '../src/baseline.mjs';

const HELP = `
  seo-audit — crawl a site's sitemap and check every page

  Usage
    npx github:nurkamol/seo-audit <url> [options]

  Reporting
    --md <file>        write a Markdown report
    --html <file>      write a self-contained HTML report (one file, no assets)
    --json <file>      write a JSON report (also usable as a baseline)
    --quiet            print nothing; rely on the exit code and the files

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
    else if (arg === '--md') opts.md = value();
    else if (arg === '--html') opts.html = value();
    else if (arg === '--json') opts.json = value();
    else if (arg === '--baseline') opts.baseline = value();
    else if (arg === '--update-baseline') opts.updateBaseline = true;
    else if (arg === '--limit') opts.limit = Number(value());
    else if (arg === '--concurrency') opts.concurrency = Number(value());
    else if (arg === '--sitemap') opts.sitemap = value();
    else if (arg === '--user-agent') opts.userAgent = value();
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
  return opts;
}

const cli = parseArgs(process.argv.slice(2));

if (cli.version) {
  const here = dirname(fileURLToPath(import.meta.url));
  console.log(JSON.parse(read(join(here, '..', 'package.json'), 'utf8')).version);
  process.exit(0);
}

if (cli.help || !cli.target) {
  console.log(HELP);
  process.exit(cli.target ? 0 : 2);
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

if (opts.failOn === 'new' && !opts.baseline) {
  console.error('  --fail-on new needs --baseline <file> to compare against.');
  process.exit(2);
}

let target = opts.target;
if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
try {
  new URL(target);
} catch {
  console.error(`Not a URL: ${opts.target}`);
  process.exit(2);
}

if (!opts.quiet) {
  process.stderr.write(`  crawling ${target} …${file.source ? ` (${file.source})` : ''}\n`);
}

if (!opts.quiet && opts.settle) {
  process.stderr.write(`  waiting up to ${opts.settle}s for the site to serve consistent HTML …\n`);
}

const { findings, meta } = await audit(target, {
  ...opts,
  onNote: (m) => !opts.quiet && process.stderr.write(`  ${m}\n`),
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
if (opts.json) writeFileSync(opts.json, serialize(findings, meta));
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
