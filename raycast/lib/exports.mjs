// Writing a report out, in whatever shape somebody needs it.
//
// This owns none of it. The list of formats, the file name and the rendering
// all live in the engine, at `@nurkamol/seo-audit/exports`, and a file exported
// from a launcher is byte for byte the one `seo-audit --csv` writes.
//
// This file used to be a second copy of that list, kept because the `./exports`
// subpath only arrived in 1.34.1 and the lockfile could not move while a Store
// submission was in review. It had already started drifting — one label read
// "Spreadsheet (CSV)" where the engine said "Spreadsheet". The dependency is on
// ^1.40.1 now, so what is left here is the part Raycast actually needs and the
// engine cannot have: `node:fs`, which the Worker imports the same module
// without.
//
// Plain ESM with no `@raycast/api` import, like the rest of `lib/`, so
// `node --test` can run it.

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { FORMATS, filenameFor, renderExport } from '@nurkamol/seo-audit/exports';

export { FORMATS, filenameFor };

/** The report as text, or the reason there is none. The engine's own renderer;
 *  the alias is what this extension has always called it. */
export const render = renderExport;

/** Write it where somebody will look for it. Returns the path, or the reason
 *  there is no path. */
export function writeReport(format, report, host, { directory = join(homedir(), 'Downloads') } = {}) {
  const { text, refused } = render(format, report);
  if (!text) return { path: null, refused };

  const path = join(directory, filenameFor(format, host));
  try {
    writeFileSync(path, text);
  } catch (error) {
    return { path: null, refused: `Could not write it: ${error.message}` };
  }
  return { path, refused: null };
}
