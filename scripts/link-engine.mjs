// Make `seo-audit` resolvable from inside raycast/.
//
// The extension depends on the engine as a published package, because a Raycast
// Store submission is the extension folder and nothing above it — `../../src`
// does not exist there. Inside this repository the package is not installed, so
// the same imports have nothing to resolve to, and both `ray build` and
// `node --test` fail on a checkout.
//
// A symlink in raycast/node_modules pointing at this repository is the whole
// fix. It costs no network, works on a fresh clone and in CI, and leaves
// raycast/package.json saying `^1.31.0` — which is what the Store needs to see.
//
// Run by `pretest`, so the tests can never quietly stop covering the extension.

import { mkdirSync, symlinkSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'raycast', 'node_modules');
const link = join(modules, 'seo-audit');

mkdirSync(modules, { recursive: true });

try {
  // `statSync` follows the link: if it resolves to this repository already,
  // there is nothing to do. If it is broken or points elsewhere, replace it.
  if (statSync(link).ino === statSync(root).ino) process.exit(0);
  rmSync(link, { recursive: true, force: true });
} catch {
  rmSync(link, { recursive: true, force: true });
}

symlinkSync(root, link, 'dir');
console.log('linked raycast/node_modules/seo-audit → the engine in this repository');
