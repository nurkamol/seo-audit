// Put the engine and a Node inside the bundle, before Tauri wraps it.
//
// The same arrangement `mac/build.sh` uses, and for the same reason: the app has
// to run on a machine with nothing installed, and the engine is JavaScript. The
// 476 KB of it is not the cost — the 108 MB runtime beneath it is, and there is
// no version of a desktop build that avoids shipping one.
//
// Each platform builds on its own runner, so the Node that gets bundled is the
// runner's own. That is deliberate: cross-compiling a runtime is a way to ship
// a binary nobody ran, and `actions/setup-node` already pins the version.

import { cpSync, mkdirSync, rmSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const repo = join(desktop, '..');
const tauri = join(desktop, 'src-tauri');

/** The triple Tauri expects on the end of a sidecar's name.
 *
 *  Asked of `rustc` rather than worked out from `process.platform`, because it
 *  is Rust's idea of this machine that has to match — and a name that is one
 *  character off does not fail loudly, it just bundles nothing. */
function targetTriple() {
  const shown = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = shown.split('\n').find((line) => line.startsWith('host:'));
  if (!host) throw new Error('rustc did not say what it targets. Is the toolchain installed?');
  return host.slice('host:'.length).trim();
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const triple = targetTriple();
const suffix = process.platform === 'win32' ? '.exe' : '';

// --- The runtime ------------------------------------------------------------
const binaries = join(tauri, 'binaries');
mkdirSync(binaries, { recursive: true });
const sidecar = join(binaries, `node-${triple}${suffix}`);
copyFileSync(process.execPath, sidecar);
console.log(`  node ${process.version} → binaries/node-${triple}${suffix}  (${mb(statSync(sidecar).size)})`);

// --- The engine -------------------------------------------------------------
// Copied rather than referenced, so what ships is a snapshot somebody can
// inspect rather than whatever the working tree happened to hold at bundle
// time. `package.json` travels because `--version` reads it, and the version is
// how the shell checks the engine beside it is not a stale one.
const engine = join(tauri, 'engine');
rmSync(engine, { recursive: true, force: true });
mkdirSync(engine, { recursive: true });
// `worker` is not optional here despite being the "optional hosted front end":
// `--serve` runs it, and `--serve` is the whole app. Leaving it out produced a
// bundle that started, spawned its engine, and then waited fifteen seconds for
// an address that was never coming — which is what building one locally before
// letting CI do it is for. `mac/build.sh` has copied all three since it shipped.
for (const part of ['bin', 'src', 'worker']) {
  cpSync(join(repo, part), join(engine, part), { recursive: true });
}
copyFileSync(join(repo, 'package.json'), join(engine, 'package.json'));

const sized = (dir) => {
  let total = 0;
  const walk = (path) => {
    const stat = statSync(path);
    if (!stat.isDirectory()) return (total += stat.size);
    for (const entry of readdirSync(path)) walk(join(path, entry));
  };
  walk(dir);
  return total;
};
console.log(`  engine → engine/  (${mb(sized(engine))})`);

// --- Prove it runs ----------------------------------------------------------
// The first bundle shipped `bin` and `src` and not `worker`, which `--serve`
// imports — so it built, installed, launched, spawned its engine and then
// waited fifteen seconds for an address that was never coming. A list of
// directories is exactly the kind of thing that looks right and is not, so it
// is not trusted: the staged copy is started, and has to answer.
//
// Here rather than in a test, because this is the script that assembles the
// thing, and it runs on all three platforms in CI.
const announced = await new Promise((resolve) => {
  const child = spawn(sidecar, [join(engine, 'bin', 'seo-audit.mjs'), '--serve', '0'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let out = '';
  let err = '';
  let settled = false;
  const give = (answer) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    child.kill();
    resolve(answer);
  };
  const timer = setTimeout(
    () => give({ ok: false, why: err.trim() || 'it never answered, and said nothing about why' }),
    20_000,
  );

  child.stdout.on('data', (chunk) => {
    out += chunk;
    if (out.includes('serving at')) give({ ok: true });
  });
  // Collected rather than reacted to. Resolving on the first chunk raced the
  // kill and reported a timeout for a process that had explained itself, which
  // is a guard describing the wrong failure.
  child.stderr.on('data', (chunk) => {
    err += chunk;
  });
  child.on('error', (error) => give({ ok: false, why: error.message }));
  child.on('close', (code) =>
    give({
      ok: false,
      why: err.trim().split('\n').slice(0, 8).join('\n') || `it exited ${code} without a word`,
    }),
  );
});

if (!announced.ok) {
  console.error(`\n  The staged engine does not run:\n\n${announced.why}\n`);
  console.error('  Something it imports was not copied. Building the bundle would produce');
  console.error('  an app that opens, starts nothing, and waits.\n');
  process.exit(1);
}
console.log('  the staged engine starts and announces a port');
console.log('  ready for: tauri build');
