// The command line and the window, kept honest about each other.
//
// Thirty-two flags and a window that reached ten of them, with nothing saying
// which of the other twenty-two were decisions. These tests make the answer
// compulsory: a flag added without an entry fails the build, and so does an
// entry claiming the window sends something it does not.
//
// Reading Swift source from a Node test is unusual and deliberate. The
// alternative is a CI job that only runs on macOS, and this needs to fail on
// the machine of whoever adds the flag, at the moment they add it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OPTIONS, runParameters, notInApp } from '../src/options.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Every flag `bin/seo-audit.mjs` actually parses. */
const parsedFlags = () =>
  new Set([...read('bin/seo-audit.mjs').matchAll(/arg === '(--[a-z-]+)'/g)].map((m) => m[1]));

/** Every query parameter the macOS app puts on a run. */
const appParameters = () =>
  new Set([...read('mac/SeoAudit/CrawlSettings.swift').matchAll(/name: "([a-zA-Z-]+)"/g)].map((m) => m[1]));

test('every flag the command line parses has an answer about the window', () => {
  const declared = new Set(OPTIONS.map((o) => o.flag));
  const missing = [...parsedFlags()].filter((flag) => !declared.has(flag));

  assert.deepEqual(missing, [],
    `${missing.join(', ')} is parsed by the CLI and missing from src/options.mjs. Add it with ` +
    'app: true if the window should reach it, or a string saying why it should not. ' +
    '"not yet" is a fine reason; an unrecorded one is not.');
});

test('the table does not describe flags that no longer exist', () => {
  const parsed = parsedFlags();
  const stale = OPTIONS.map((o) => o.flag).filter((flag) => !parsed.has(flag));
  assert.deepEqual(stale, [], `${stale.join(', ')} is in src/options.mjs and the CLI does not parse it`);
});

test('a flag the table says the window sends, the window sends', () => {
  const sent = appParameters();
  const claimed = runParameters();
  assert.ok(claimed.length > 0, 'the table should describe some run parameters');

  const broken = claimed.filter((o) => !sent.has(o.query));
  assert.deepEqual(broken.map((o) => o.flag), [],
    `src/options.mjs says the window sends ${broken.map((o) => o.query).join(', ')} and ` +
    'CrawlSettings.swift does not. Wire it up, or change the entry to say why it does not.');
});

test('a parameter the window sends is one the table knows about', () => {
  // The other direction: the window inventing a parameter the engine has no
  // flag for would be a setting that quietly does nothing.
  const known = new Set([
    ...OPTIONS.map((o) => o.query).filter(Boolean),
    'url',      // the site itself, not a flag
    'format',   // how the answer comes back, not a flag
  ]);
  const orphans = [...appParameters()].filter((name) => !known.has(name));
  assert.deepEqual(orphans, [],
    `the window sends ${orphans.join(', ')}, which no flag in src/options.mjs corresponds to`);
});

// The macOS app has a Swift test suite of its own, and `npm test` cannot run
// it: `swift test` needs a toolchain that most machines touching this repo do
// not have, which is the same reason the checks above read Swift source rather
// than running it. That suite pins the parameters a default run sends, in a
// list of its own — and adding `llms-out` and `schema-out` left it stale, so a
// release job failed on it minutes after everything here was green.
//
// So the two lists are compared here instead, on whatever machine changed one.
test('the app\'s own test knows which parameters every run sends', () => {
  // The literals inside `var items = [...]` in queryItems() — the ones sent
  // unconditionally, rather than the ones a setting adds.
  const swift = read('mac/SeoAudit/CrawlSettings.swift');
  const block = swift.slice(swift.indexOf('var items = ['), swift.indexOf(']', swift.indexOf('var items = [')));
  const always = new Set([...block.matchAll(/name: "([a-zA-Z-]+)"/g)].map((m) => m[1]));
  assert.ok(always.size >= 3, 'expected to find the unconditional parameters');

  // What ModelTests.swift asserts a default run sends.
  const tests = read('mac/Tests/SeoAuditTests/ModelTests.swift');
  const expectation = tests.match(/#expect\(names == \[([^\]]+)\]\)/);
  assert.ok(expectation, 'ModelTests.swift no longer pins the default parameters');
  const pinned = new Set([...expectation[1].matchAll(/"([a-zA-Z-]+)"/g)].map((m) => m[1]));

  const missing = [...always].filter((name) => !pinned.has(name));
  const stale = [...pinned].filter((name) => !always.has(name));
  assert.deepEqual(missing, [],
    `CrawlSettings.swift always sends ${missing.join(', ')} and ModelTests.swift does not expect it. ` +
    'Add it there, or `swift test` fails in CI long after this passed.');
  assert.deepEqual(stale, [],
    `ModelTests.swift expects ${stale.join(', ')} and CrawlSettings.swift no longer sends it`);
});

// The version lives in four files and a bump touches one of them.
//
// This is not tidiness. The desktop shell refuses to start when its own version
// disagrees with the engine's — that guard exists because Tauri's Windows
// installer can replace one and not the other, and a stale engine runs old
// checks while looking new. The guard compares `CARGO_PKG_VERSION` with what
// `bin/seo-audit.mjs --version` prints, which is the root `package.json`. Bump
// one without the other and every bundled build refuses to open, on somebody
// else's machine, after the tag is already pushed.
test('every file that carries the version agrees about it', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/, 'the engine should have a plain semver');

  const elsewhere = {
    'desktop/package.json': JSON.parse(read('desktop/package.json')).version,
    'desktop/src-tauri/tauri.conf.json': JSON.parse(read('desktop/src-tauri/tauri.conf.json')).version,
    'desktop/src-tauri/Cargo.toml':
      read('desktop/src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1],
  };

  const disagreeing = Object.entries(elsewhere)
    .filter(([, theirs]) => theirs !== version)
    .map(([file, theirs]) => `${file} says ${theirs ?? '(nothing)'}`);

  assert.deepEqual(disagreeing, [],
    `package.json says ${version} and ${disagreeing.join(', ')}. The desktop shell refuses to ` +
    'start when its version and the engine\'s disagree, so this is not cosmetic.');
});

test('the winget identifier the workflow publishes is the one the shell looks for', () => {
  // Windows' update path runs `winget list --id <identifier>` to find out whether
  // this copy came from winget, and `winget upgrade --id <identifier>` to move
  // it. Both are silent when the identifier is one winget has never heard of —
  // no error, no output, just an app that never offers an update. So the name in
  // the Rust and the name the release workflow submits under have to be the same
  // string, and nothing at runtime would ever tell us they had drifted.
  const workflow = read('.github/workflows/desktop.yml');
  const published = workflow.match(/^\s*identifier:\s*(\S+)\s*$/m)?.[1];
  assert.ok(published, 'the desktop workflow should submit a winget manifest under some identifier');

  // One constant in the Rust, because the query, the upgrade command and this
  // check all have to mean the same package.
  const rust = read('desktop/src-tauri/src/updates.rs');
  const declared = rust.match(/pub const WINGET_ID: &str = "([^"]+)";/)?.[1];
  assert.ok(declared, 'updates.rs should declare WINGET_ID');

  assert.equal(declared, published,
    `updates.rs asks winget about ${declared}, but the workflow publishes ${published}. ` +
    'winget answers a name it does not know with silence, so this drift would ship as ' +
    'a Windows build that simply never finds an update.');

  // And nothing may go back to spelling it out by hand.
  const literals = [...rust.matchAll(/"--id",\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(literals, [],
    'the identifier belongs in WINGET_ID, not written out again beside it');
});

test('every reason is a sentence somebody can act on', () => {
  for (const { flag, reason } of notInApp()) {
    assert.equal(typeof reason, 'string', `${flag} needs a reason, not ${reason}`);
    assert.ok(reason.length > 12, `${flag}: "${reason}" does not say enough to be a decision`);
  }
});

test('nothing is declared twice', () => {
  const flags = OPTIONS.map((o) => o.flag);
  assert.equal(new Set(flags).size, flags.length, 'a flag appears twice in src/options.mjs');
  const queries = OPTIONS.map((o) => o.query).filter(Boolean);
  assert.equal(new Set(queries).size, queries.length, 'two flags claim the same query parameter');
});

test('no source file is a binary file to git', () => {
  // Three files had a literal NUL byte in them, each used as a separator or a
  // placeholder — correct values, written the wrong way. A raw control byte
  // makes the whole file binary: `grep` skips it and `git diff` refuses to show
  // it, which is how a glob matcher sat in src/config.mjs for months while
  // somebody went looking for one.
  //
  // The value is fine. Write it as an escape.
  const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(mjs|js|swift|json|md|yml|html|css|sh)$/.test(f));

  const offenders = [];
  for (const file of tracked) {
    const bytes = readFileSync(join(root, file));
    for (const byte of bytes) {
      // Everything below space except tab, newline and carriage return.
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
        offenders.push(file);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [],
    `${offenders.join(', ')} contains a raw control byte. Write it as an escape ` +
    '(\\u0000) so the file stays text.');
});

test('the app is built from the four named radii, not from eight numbers', () => {
  // There were eight, in nine files: 6, 10, 12, 15, 16, 20, 26 and 28. The
  // pairs are the tell — nobody decides a text field is 15 and the tally card
  // beside it is 16. Each was chosen alone, months apart, and "almost
  // consistent" reads worse than plainly inconsistent, because the eye notices
  // the two points without being able to name them.
  const files = execSync('git ls-files "mac/SeoAudit/*.swift"', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.endsWith('Design.swift'));   // where the scale is defined

  const offenders = [];
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const match of source.matchAll(/cornerRadius:\s*(\d+)/g)) {
      offenders.push(`${file}: cornerRadius: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, [],
    `${offenders.join(', ')} — use Radius.pill, .control, .card or .surface. ` +
    'A fifth radius should need an argument.');
});

test('every settings text field looks like one', () => {
  // A TextField in a grouped Form draws as right-aligned grey text with no box,
  // which is exactly how that Form draws a read-only value. "Sitemap · Found
  // automatically" then reads as a fact about the site rather than as an empty
  // field somebody can type in. `.roundedBorder` is what tells them apart.
  const source = readFileSync(join(root, 'mac/SeoAudit/SettingsScene.swift'), 'utf8');
  const fields = [...source.matchAll(/TextField\((?:[^()]|\([^()]*\))*\)([\s\S]{0,220})/g)];
  assert.ok(fields.length > 0, 'expected some text fields to check');

  const bare = fields.filter(([, after]) => !after.includes('.textFieldStyle('));
  assert.equal(bare.length, 0,
    `${bare.length} settings text field(s) have no .textFieldStyle — in a grouped Form they ` +
    'render as static grey text and stop looking editable.');
});
