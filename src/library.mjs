// Runs, kept on disk, for the local server.
//
// The macOS window has kept every finished run since 1.23.0 and `--serve` kept
// none, so somebody on Linux or Windows got one report and lost it the moment
// they audited something else. A seven-minute crawl should only ever happen
// once, and that is not a macOS-only claim.
//
// It writes **the same folder the app uses**, in the same shape, so a run
// started in the window is in the browser's list a second later and the other
// way round — nothing is synchronised, exported or copied, because there is one
// folder and both front ends read it.
//
// This is Node, and `worker/index.mjs` must not be: it runs on Cloudflare too,
// where there is no filesystem. So the server hands the worker an object with
// these four methods and the worker calls them if they are there. A deployed
// Worker passes nothing and has no library, which is correct — a shared host
// keeping strangers' crawls is a thing nobody asked for.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Where an application keeps documents it manages, per platform.
 *
 *  macOS is `Application Support`, and deliberately the *same* path
 *  `Support.directory()` uses on the Swift side — named for the bundle id
 *  rather than the display name — so the window and the browser share one
 *  library rather than each having their own.
 *
 *  Caches would be wrong everywhere: the system may delete those, and seven
 *  minutes of crawling is not a cache. */
export function libraryRoot(env = process.env, os = platform()) {
  if (env.SEO_AUDIT_HOME) return env.SEO_AUDIT_HOME;
  const home = homedir();
  if (os === 'darwin') return join(home, 'Library', 'Application Support', 'seo-audit');
  if (os === 'win32') {
    return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'seo-audit');
  }
  // Linux and the BSDs: the XDG basedir spec, which says $XDG_DATA_HOME and
  // falls back to ~/.local/share.
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'seo-audit');
}

/** How many runs to keep. The same bound the window applies, for the same
 *  reason: this is a list to click rather than an archive. */
const KEEP = 40;

/** A store the Worker can call without knowing it is talking to a filesystem. */
export function library(root = libraryRoot()) {
  const folder = join(root, 'reports');
  const indexFile = join(root, 'index.json');
  mkdirSync(folder, { recursive: true });

  const readIndex = () => {
    if (!existsSync(indexFile)) return [];
    try {
      const rows = JSON.parse(readFileSync(indexFile, 'utf8'));
      // An index entry whose file is gone is a row that opens onto nothing,
      // which is worse than not listing it — a folder can be emptied by a sync
      // tool without the index being told.
      return Array.isArray(rows)
        ? rows.filter((row) => row?.id && existsSync(join(folder, `${row.id}.json`)))
        : [];
    } catch {
      return [];
    }
  };

  const writeIndex = (rows) => {
    try {
      writeFileSync(indexFile, JSON.stringify(rows, null, 2));
    } catch {
      /* a library that cannot be written is not a reason to lose the report */
    }
  };

  return {
    /** Every kept run, newest first. */
    list() {
      return readIndex().sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    },

    /** One run, exactly as the engine wrote it. `null` when it is not there. */
    read(id) {
      // The id comes off a URL, so it is checked rather than trusted: anything
      // but a UUID cannot become a path.
      if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) return null;
      try {
        return JSON.parse(readFileSync(join(folder, `${id}.json`), 'utf8'));
      } catch {
        return null;
      }
    },

    /** Keep a finished run. `payload` is what the engine produced, byte for
     *  byte — not this server's idea of it, so a report saved by one version
     *  still opens in the next and `jq` works on it. */
    keep(payload, { site, finishedAt = new Date().toISOString() } = {}) {
      const id = randomUUID();
      const counts = { error: 0, warn: 0, info: 0 };
      for (const finding of payload.findings ?? []) counts[finding.level] += 1;

      let host = site;
      try {
        host = new URL(payload.meta?.origin ?? site).host;
      } catch {
        /* keep whatever was passed */
      }

      const row = {
        id,
        host,
        site: payload.meta?.origin ?? site,
        finishedAt,
        pages: payload.meta?.pages ?? 0,
        findings: (payload.findings ?? []).length,
        causes: (payload.causes ?? []).length,
        errors: counts.error,
        warnings: counts.warn,
        // The same field the window writes, so one list shows both.
        ...(typeof payload.score?.score === 'number' ? { score: payload.score.score } : {}),
      };

      try {
        writeFileSync(join(folder, `${id}.json`), JSON.stringify(payload));
      } catch {
        return null;
      }

      const rows = [row, ...readIndex()];
      for (const old of rows.slice(KEEP)) {
        try {
          rmSync(join(folder, `${old.id}.json`), { force: true });
        } catch {
          /* already gone */
        }
      }
      writeIndex(rows.slice(0, KEEP));
      return row;
    },

    /** Where the files are, and what they take up — "small" is a claim
     *  somebody is entitled to check. */
    where: () => folder,
    bytes() {
      return readIndex().reduce((total, row) => {
        try {
          return total + statSync(join(folder, `${row.id}.json`)).size;
        } catch {
          return total;
        }
      }, 0);
    },
  };
}
