// Which AI crawlers a site lets in, and which it does not.
//
// The answer engines fetch with their own user agents and obey robots.txt like
// anything else, so a site's position on being read by them is already written
// down in a file it already serves — nobody has to be asked and nothing has to
// be estimated. That is the whole of this module: `robotsVerdict()` has taken
// an agent since it was written, and this hands it the ten names that matter.
//
// **Blocking these is not a fault.** A publisher who does not want their work
// in a model's training set and says so in robots.txt has done the correct
// thing, correctly. So the finding is a note, phrased as a fact, and the report
// is careful never to imply otherwise — the rule about checks that cry wolf
// applies with particular force to a check somebody could reasonably have
// meant. What it is for is the case nobody chose: a CDN, a WordPress plugin or
// a hosting default that added `Disallow` lines the site's owner has never
// seen, and which quietly costs them every citation in every AI answer.

/** The agents worth asking about, and what each one is for.
 *
 *  Two things are deliberately distinguished, because conflating them is the
 *  usual mistake: **training** crawlers gather text to train on, and blocking
 *  one changes nothing about whether you can be cited today. **Answering**
 *  crawlers fetch a page because somebody asked a question just now, and
 *  blocking one removes you from that answer. A site that meant to opt out of
 *  training and blocked both has almost certainly not read the difference. */
export const AI_AGENTS = [
  { token: 'gptbot', name: 'GPTBot', vendor: 'OpenAI', purpose: 'training' },
  { token: 'oai-searchbot', name: 'OAI-SearchBot', vendor: 'OpenAI', purpose: 'answering' },
  { token: 'chatgpt-user', name: 'ChatGPT-User', vendor: 'OpenAI', purpose: 'answering' },
  { token: 'claudebot', name: 'ClaudeBot', vendor: 'Anthropic', purpose: 'training' },
  { token: 'claude-searchbot', name: 'Claude-SearchBot', vendor: 'Anthropic', purpose: 'answering' },
  { token: 'claude-user', name: 'Claude-User', vendor: 'Anthropic', purpose: 'answering' },
  { token: 'perplexitybot', name: 'PerplexityBot', vendor: 'Perplexity', purpose: 'answering' },
  { token: 'perplexity-user', name: 'Perplexity-User', vendor: 'Perplexity', purpose: 'answering' },
  { token: 'google-extended', name: 'Google-Extended', vendor: 'Google', purpose: 'training' },
  { token: 'applebot-extended', name: 'Applebot-Extended', vendor: 'Apple', purpose: 'training' },
  { token: 'meta-externalagent', name: 'meta-externalagent', vendor: 'Meta', purpose: 'training' },
  { token: 'ccbot', name: 'CCBot', vendor: 'Common Crawl', purpose: 'training' },
  { token: 'bytespider', name: 'Bytespider', vendor: 'ByteDance', purpose: 'training' },
];

/** Whether an agent's own name appears anywhere in the file.
 *
 *  The difference between a decision and a default. `User-agent: *` with
 *  `Disallow: /private` blocks GPTBot from /private without anybody having
 *  thought about GPTBot; `User-agent: GPTBot` with `Disallow: /` is somebody
 *  who did. Only the second is a position, and only the first is worth telling
 *  a site's owner about. */
const named = (groups, token) => groups.some((group) => group.agents.includes(token));

/** How each AI agent is treated at the site root.
 *
 *  `verdict` is asked of the same function every other robots question in this
 *  project goes through, so a rule this reads and a rule Google reads are the
 *  same rule — including the part where a longer `Allow` beats a `Disallow`.
 *
 *  @returns {{ agent: object, allowed: boolean, explicit: boolean }[]}
 */
export function aiAccess(groups, robotsVerdict, path = '/') {
  return AI_AGENTS.map((agent) => ({
    agent,
    allowed: robotsVerdict(groups, path, agent.token).allowed,
    explicit: named(groups, agent.token),
  }));
}

/** One sentence naming who is shut out, split by what shutting them out costs.
 *
 *  Returns null when everybody is let in, because a report saying "nothing is
 *  blocked" once per site is a line nobody reads and this project has enough
 *  of those already. */
export function describeAccess(access) {
  const blocked = access.filter((row) => !row.allowed);
  if (!blocked.length) return null;

  const answering = blocked.filter((row) => row.agent.purpose === 'answering');
  const training = blocked.filter((row) => row.agent.purpose === 'training');
  const list = (rows) => rows.map((row) => row.agent.name).join(', ');

  const parts = [];
  if (answering.length) {
    parts.push(
      `${list(answering)} fetch a page because somebody asked a question just now, so blocking them ` +
        'removes the site from those answers today',
    );
  }
  if (training.length) {
    parts.push(
      `${list(training)} gather text to train on, and blocking them changes nothing about whether the ` +
        'site can be cited today',
    );
  }
  // Whether anybody actually decided this. A block that arrives through
  // `User-agent: *` is usually a default nobody chose.
  const decided = blocked.some((row) => row.explicit);
  parts.push(
    decided
      ? 'These are named in robots.txt, so this looks deliberate — this is a note, not a fault'
      : 'None of these are named in robots.txt: they are caught by a `User-agent: *` rule, which is ' +
        'usually a CDN or plugin default rather than a decision anybody made',
  );

  return {
    blocked,
    answering,
    training,
    decided,
    detail: `${parts.join('. ')}.`,
  };
}
