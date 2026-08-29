// Both suites, from one command.
//
// There are three, and only one of them runs by default: `node --test` over
// `test/`, which is portable and needs nothing installed; `swift test` over
// `mac/Tests/`; and `cargo test` over `desktop/`. The last two need toolchains
// most machines touching this repo do not have. Keeping the first cross-platform is deliberate — the whole
// premise is that this works on a machine with nothing on it.
//
// The cost of that split showed up in 1.34.0: everything here was green, the
// release published, and `swift test` had been failing on main the whole time
// because two of its expectations still described the old behaviour. So this
// exists, and so does the rule it follows.
//
// **A suite that did not run says so.** It never exits 0 quietly having
// skipped half the work, because a suite that was skipped reads exactly like a
// suite that passed — the same failure this project refuses in its reports.

import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';

const run = (command, args) =>
  spawnSync(command, args, { stdio: 'inherit', shell: false }).status ?? 1;

const has = (command) =>
  spawnSync(command, ['--version'], { stdio: 'ignore', shell: false }).status === 0;

// Found rather than listed, so a new test file is picked up by having been
// written. `npm test` expands the same glob in the shell; this cannot, because
// running through a shell is how an argument with a space in it becomes two.
const files = readdirSync('test')
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `test/${name}`);

console.log('\n── The engine, the Worker and the extension ─────────────────\n');
const node = run(process.execPath, ['--test', ...files]);

console.log('\n── The desktop shell ───────────────────────────────────────\n');
// Rust, which most machines touching this repo do not have either. Same rule:
// a suite that did not run says so rather than being absent from the tally.
// Tauri's build script validates `externalBin` at compile time, so cargo
// cannot even compile the tests until a Node has been staged beside them. That
// is a 110 MB copy, which is not something a test run should do behind
// somebody's back — so it is reported as not run, with the command that fixes
// it, exactly like a missing toolchain.
const staged = (() => {
  if (!has('rustc')) return false;
  const host = spawnSync('rustc', ['-vV'], { encoding: 'utf8' }).stdout ?? '';
  const triple = host.split('\n').find((line) => line.startsWith('host:'))?.slice(5).trim();
  if (!triple) return false;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return existsSync(`desktop/src-tauri/binaries/node-${triple}${suffix}`);
})();

const canRunCargo = has('cargo') && staged;
let cargo = 0;
if (!has('cargo')) {
  console.log('  Not run: no Rust toolchain here. `brew install rustup` adds one.');
  console.log('  CI runs them on every push.\n');
} else if (!staged) {
  console.log('  Not run: no engine is staged beside the shell, and Tauri will not');
  console.log('  compile without one. `cd desktop && npm run stage` puts it there.\n');
} else {
  cargo = run('cargo', ['test', '--manifest-path', 'desktop/src-tauri/Cargo.toml', '--quiet']);
}

console.log('\n── The macOS app ───────────────────────────────────────────\n');
// Asked once. Two calls could disagree, and the summary at the bottom must
// describe the run that actually happened.
const canRunSwift = process.platform === 'darwin' && has('swift');
let swift = 0;
if (!canRunSwift) {
  console.log(
    process.platform === 'darwin'
      ? '  Not run: no Swift toolchain here. `xcode-select --install` adds one.'
      : `  Not run: the app's tests need macOS, and this is ${process.platform}.`,
  );
  console.log('  CI runs them on every push, and again before a release is built.\n');
} else {
  swift = run('swift', ['test']);
}

// One line at the end, because the two suites print hundreds between them and
// the answer should not have to be scrolled for.
const verdict = (name, code, skipped) =>
  `  ${skipped ? '·' : code === 0 ? '✓' : '✗'} ${name}${skipped ? ' — not run here' : code === 0 ? '' : ' — failed'}`;

console.log('\n────────────────────────────────────────────────────────────');
console.log(verdict('engine, Worker, extension', node, false));
console.log(verdict('desktop shell', cargo, !canRunCargo));
console.log(verdict('macOS app', swift, !canRunSwift));
console.log('');

process.exit(node || cargo || swift);
