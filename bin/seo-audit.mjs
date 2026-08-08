#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { audit } from '../src/audit.mjs';
import { terminal, markdown, counts } from '../src/report.mjs';

const HELP = `
  seo-audit — crawl a site's sitemap and check every page

  Usage
    npx github:nurkamol/seo-audit <url> [options]

  Options
    --md <file>        also write a Markdown report
    --limit <n>        maximum pages to check (default 200)
    --concurrency <n>  parallel requests (default 6)
    --sitemap <url>    sitemap location, if not /sitemap-index.xml or /sitemap.xml
    --fail-on <level>  exit 1 when findings reach this level: error | warn | never
                       (default: error)
    --quiet            print nothing; rely on the exit code and --md
    --help

  Examples
    npx github:nurkamol/seo-audit https://example.com
    npx github:nurkamol/seo-audit https://example.com --md audit.md
    npx github:nurkamol/seo-audit http://localhost:4321 --limit 20 --fail-on warn

  Performance is not measured here — use pagespeed.web.dev and webpagetest.org,
  which run real browsers. This checks correctness, on every page.
`;

function parseArgs(argv) {
  const opts = { failOn: 'error' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--md') opts.md = value();
    else if (arg === '--limit') opts.limit = Number(value());
    else if (arg === '--concurrency') opts.concurrency = Number(value());
    else if (arg === '--sitemap') opts.sitemap = value();
    else if (arg === '--fail-on') opts.failOn = value();
    else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    } else rest.push(arg);
  }
  opts.target = rest[0];
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.target) {
  console.log(HELP);
  process.exit(opts.target ? 0 : 2);
}

let target = opts.target;
if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
try {
  new URL(target);
} catch {
  console.error(`Not a URL: ${opts.target}`);
  process.exit(2);
}

if (!opts.quiet) process.stderr.write(`  crawling ${target} …\n`);

const { findings, meta } = await audit(target, opts);

if (!opts.quiet) console.log(terminal(findings, meta));

if (opts.md) {
  writeFileSync(opts.md, markdown(findings, meta));
  if (!opts.quiet) console.log(`  report → ${opts.md}\n`);
}

const n = counts(findings);
const shouldFail =
  (opts.failOn === 'error' && n.error > 0) ||
  (opts.failOn === 'warn' && n.error + n.warn > 0);
process.exit(shouldFail ? 1 : 0);
