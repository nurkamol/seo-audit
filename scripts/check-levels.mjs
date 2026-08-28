// Which levels each check id is actually emitted at, read out of the source.
//
// Two things need it and neither can be trusted to remember: `src/score.mjs`
// declares the worst level every scored check can reach — that is what its
// weight is — and a check quietly promoted from a warning to an error would
// otherwise keep its old weight forever. The test asserts this against the
// table, so the failure lands on the machine of whoever changed the level.
//
// It reads source rather than running the checks because most of these fire
// only on a site that has the fault, and a fixture site with all 162 faults is
// a fixture nobody would maintain.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LEVEL = /'(error|warn|info)'/;

/** id → Set of levels, over every .mjs under a directory. */
export function emittedLevels(dir = new URL('../src/', import.meta.url).pathname) {
  const found = new Map();
  const add = (id, level) => found.set(id, (found.get(id) ?? new Set()).add(level));

  for (const name of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    const src = readFileSync(join(dir, name), 'utf8');

    // 'warn', 'og-webp' — the shorthand every per-page check uses, and the
    // same pair inside `say('hops', 'warn', 'redirect-hops', …)`. Adjacency
    // rather than a leading paren, so a helper's own arguments are read too.
    // A level name is never a check id, so `new Set(['error', 'warn'])` is
    // not a check called "warn".
    for (const m of src.matchAll(/'(error|warn|info)',\s*'([a-z0-9-]+)'/g)) {
      if (!LEVEL.test(`'${m[2]}'`)) add(m[2], m[1]);
    }

    // { level: 'warn', id: 'og-webp', … } and the same two keys the other way
    // round. A window rather than a parse: these are object literals in a file
    // this project is not going to grow an AST for.
    for (const m of src.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)) {
      const before = src.slice(Math.max(0, m.index - 400), m.index);
      const after = src.slice(m.index, m.index + 400);
      const near = before.split(/\blevel:\s*/).pop();
      const ahead = after.split(/\blevel:\s*/)[1];
      // Whichever mention of `level` is closer to this id, and only when it is
      // in the same literal — a `}` between them means it belongs elsewhere.
      const back = before.includes('level:') && !/[}]/.test(near) ? near.match(LEVEL)?.[1] : null;
      const fwd = ahead !== undefined && !/[}]/.test(after.slice(0, after.indexOf('level:'))) ? ahead.match(LEVEL)?.[1] : null;
      if (back) add(m[1], back);
      else if (fwd) add(m[1], fwd);
    }
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = emittedLevels();
  for (const id of [...found.keys()].sort()) console.log(`${id}\t${[...found.get(id)].sort().join(',')}`);
}
