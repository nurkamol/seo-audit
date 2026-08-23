// Presenting as something other than this tool.
//
// Three reasons a real audit needs it, and none of them is dressing up:
//
//   - A site that answers a browser and blocks everything else is common, and
//     the report from a blocked crawl is a report about the block.
//   - Some sites serve different HTML to a crawler than to a person. Fetching
//     as Googlebot is the only way to see what Google is given.
//   - Google indexes what its smartphone crawler sees. On a site that serves a
//     different page to phones, that is the page that matters.
//
// The strings below are a snapshot and will age; browser versions move every
// few weeks and nothing here can know that. They are close enough for a server
// deciding whether to answer, and `--user-agent` still takes a literal string
// for anything that has to be exact.

// Googlebot's two user agents, quoted from Google's own crawler documentation.
// Google publishes the Chrome version as the placeholder `W.X.Y.Z`; the real
// crawler sends a concrete one, so a plausible version is substituted here.
const GOOGLEBOT_CHROME = '131.0.6778.264';

const BOTS = {
  googlebot:
    `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${GOOGLEBOT_CHROME} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
  'googlebot-desktop':
    `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; ` +
    `+http://www.google.com/bot.html) Chrome/${GOOGLEBOT_CHROME} Safari/537.36`,
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
};

// What each system calls itself in a user agent. Chrome and Firefox both froze
// these years ago — the macOS one says 10_15_7 on every Mac made since, and
// that is correct rather than stale.
const SYSTEM = {
  macos: { chromium: 'Macintosh; Intel Mac OS X 10_15_7', gecko: 'Macintosh; Intel Mac OS X 10.15' },
  windows: { chromium: 'Windows NT 10.0; Win64; x64', gecko: 'Windows NT 10.0; Win64; x64' },
  linux: { chromium: 'X11; Linux x86_64', gecko: 'X11; Linux x86_64' },
  android: { chromium: 'Linux; Android 10; K', gecko: 'Android 15; Mobile' },
  ios: { chromium: 'iPhone; CPU iPhone OS 18_5 like Mac OS X', gecko: 'iPhone; CPU iPhone OS 18_5 like Mac OS X' },
};

const CHROME = '141.0.0.0';
const FIREFOX = '143.0';
const SAFARI = '18.6';
const EDGE = '141.0.0.0';

/** Every browser that can run on a system, and what it says when it does.
 *
 *  Absent combinations are absent on purpose: Safari does not run on Windows or
 *  Linux, and inventing a user agent for one would be describing a machine that
 *  does not exist. */
const BROWSERS = {
  chrome: {
    macos: (s) => `Mozilla/5.0 (${s}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`,
    windows: null, // filled below — the string is identical bar the system
    linux: null,
    android: (s) => `Mozilla/5.0 (${s}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36`,
    ios: (s) =>
      `Mozilla/5.0 (${s}) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/${CHROME} Mobile/15E148 Safari/604.1`,
  },
  firefox: {
    macos: (s) => `Mozilla/5.0 (${s}; rv:${FIREFOX}) Gecko/20100101 Firefox/${FIREFOX}`,
    windows: null,
    linux: null,
    android: (s) => `Mozilla/5.0 (${s}; rv:${FIREFOX}) Gecko/${FIREFOX} Firefox/${FIREFOX}`,
    ios: (s) => `Mozilla/5.0 (${s}) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/${FIREFOX} Mobile/15E148 Safari/605.1.15`,
  },
  safari: {
    macos: (s) => `Mozilla/5.0 (${s}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${SAFARI} Safari/605.1.15`,
    ios: (s) => `Mozilla/5.0 (${s}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${SAFARI} Mobile/15E148 Safari/604.1`,
  },
  edge: {
    macos: (s) =>
      `Mozilla/5.0 (${s}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${EDGE}`,
    windows: null,
    linux: null,
  },
};
for (const browser of ['chrome', 'firefox', 'edge']) {
  for (const os of ['windows', 'linux']) {
    if (BROWSERS[browser][os] === null) BROWSERS[browser][os] = BROWSERS[browser].macos;
  }
}

export const BROWSER_NAMES = [...Object.keys(BROWSERS), ...Object.keys(BOTS)];
export const OS_NAMES = Object.keys(SYSTEM);

/** The system this is running on, so `--browser chrome` alone means "as a
 *  browser on this machine" rather than making everyone name their own OS. */
export function thisPlatform(platform = process.platform) {
  return { darwin: 'macos', win32: 'windows' }[platform] ?? 'linux';
}

/** A user agent for a browser and a system, or an explanation of why not.
 *
 *  Returns `{ ua }` or `{ error }`. Never guesses: a combination that does not
 *  exist in the world is refused rather than approximated, because the whole
 *  point of the flag is to be believed by a server. */
export function userAgentFor(browser, os = thisPlatform()) {
  const name = String(browser ?? '').toLowerCase();
  const system = String(os ?? '').toLowerCase();

  if (BOTS[name]) {
    // A crawler's user agent says nothing about a machine, so an --os alongside
    // it is a question with no answer rather than a conflict worth refusing.
    return { ua: BOTS[name], ignoredOs: Boolean(os) && os !== thisPlatform() };
  }
  if (!BROWSERS[name]) {
    return { error: `Unknown browser "${browser}". Try one of: ${BROWSER_NAMES.join(', ')}.` };
  }
  if (!SYSTEM[system]) {
    return { error: `Unknown system "${os}". Try one of: ${OS_NAMES.join(', ')}.` };
  }
  const build = BROWSERS[name][system];
  if (!build) {
    const runs = Object.keys(BROWSERS[name]).join(', ');
    return { error: `${browser} does not run on ${os}. It runs on: ${runs}.` };
  }
  const engine = name === 'firefox' ? 'gecko' : 'chromium';
  return { ua: build(SYSTEM[system][engine]) };
}
