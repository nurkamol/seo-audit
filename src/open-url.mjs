// Opening a URL in whatever the person's system calls a browser.
//
// Three commands for three platforms and no dependency, which is the whole
// reason this is nine lines rather than an `open` package. Detached and with
// its output thrown away: the launcher exits immediately on every platform, and
// a server that waits on it would hang on the one that does not.

import { spawn } from 'node:child_process';

/** The command that opens a URL, per platform. `null` where there is nothing
 *  to try — a container, or a system this has no answer for. */
export function opener(platform = process.platform) {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [] };
    // `start` is a shell builtin rather than a program, so it needs cmd. The
    // empty string is the window title `start` otherwise steals from the URL,
    // and leaving it out is the classic bug where nothing opens.
    case 'win32':
      return { command: 'cmd', args: ['/c', 'start', ''] };
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return { command: 'xdg-open', args: [] };
    default:
      return null;
  }
}

/** Open a URL. Returns false when there was nothing to try, or when the
 *  launcher could not be started — never throws, because failing to open a
 *  browser is not a reason for a server not to run. The URL is already on
 *  screen either way. */
export function openUrl(url, { platform = process.platform, spawnFn = spawn } = {}) {
  const how = opener(platform);
  if (!how) return false;
  try {
    const child = spawnFn(how.command, [...how.args, url], {
      stdio: 'ignore',
      detached: true,
    });
    // Not waited on: the parent is a server that should outlive the launcher.
    child.on?.('error', () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
