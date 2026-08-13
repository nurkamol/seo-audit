// The questions asked when someone runs the bare command.
//
// This exists to be a friendlier first thirty seconds, not a menu to live in.
// It asks the minimum, then prints the command it assembled and runs that — so
// the second use is a one-liner and the flags are learned rather than hidden.
//
// The readline interface is passed in rather than created here, so the flow can
// be tested without a terminal. Whether to ask at all is `isInteractive`, and
// the answer is no far more often than people expect: a pipe, a CI runner, a
// `| tee`, an editor's task runner. A prompt that blocks a build waiting for
// input nobody can type is much worse than the help text it replaced.

export const isInteractive = (streams = process) =>
  Boolean(streams.stdin?.isTTY && streams.stdout?.isTTY);

/** The one-line command that reproduces this run. */
export function invocation(url, { html } = {}) {
  return ['seo-audit', url, html ? `--html ${html}` : ''].filter(Boolean).join(' ');
}

/**
 * @param {{question: (q: string) => Promise<string>}} rl
 * @returns {Promise<{url: string, html?: string}|null>} null if there is no
 *   usable answer — an empty line, or a stream that closed under us.
 */
export async function askForSite(rl) {
  try {
    const url = (await rl.question('  Site to audit:            ')).trim();
    if (!url) return null;

    const html = /^y(es)?$/i.test((await rl.question('  Save an HTML report? [y/N] ')).trim());
    return html ? { url, html: 'seo-audit.html' } : { url };
  } catch {
    // Ctrl-C, or EOF on a stream that looked like a terminal and was not.
    return null;
  }
}
