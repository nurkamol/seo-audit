// robots.txt, read the way Google reads it.
//
// The subtlety that decides whether this check is useful or noise: Allow and
// Disallow are not first-match-wins. The most specific rule wins — the longest
// path pattern — and a tie goes to Allow. Implementing only Disallow would
// report every site that carves an exception out of a broad block, which is
// most sites that have ever written:
//
//   Disallow: /wp-admin/
//   Allow: /wp-admin/admin-ajax.php
//
// Patterns support `*` for any run of characters and a trailing `$` to anchor
// the end. Everything else is a literal prefix match.

/** Group records from a robots.txt body: [{ agents, rules }]. */
export function parseRobots(body) {
  const groups = [];
  let current = null;
  // Consecutive User-agent lines share one group of rules; a User-agent line
  // *after* a rule starts a new group.
  let namingAgents = false;

  for (const raw of (body ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;

    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === 'user-agent') {
      if (!namingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        namingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (field === 'allow' || field === 'disallow') {
      if (!current) continue; // A rule before any User-agent line belongs to nobody.
      namingAgents = false;
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return groups;
}

/** Does a rule pattern cover this path? */
function covers(pattern, path) {
  // `Disallow:` with no value is the documented way to say "nothing", and must
  // not be read as "everything".
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const rx = body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${rx}${anchored ? '$' : ''}`).test(path);
}

/** The group that applies to an agent: its own, or the `*` fallback. */
function groupFor(groups, agent) {
  return (
    groups.find((g) => g.agents.includes(agent)) ??
    groups.find((g) => g.agents.includes('*')) ??
    null
  );
}

/**
 * Whether `path` may be crawled, and which rule decided it.
 *
 * Googlebot is the default agent because it is the one whose opinion shows up
 * in search results, which is the only reason this tool asks.
 */
export function robotsVerdict(groups, path, agent = 'googlebot') {
  const group = groupFor(groups, agent);
  if (!group) return { allowed: true, rule: null };

  let best = null;
  for (const rule of group.rules) {
    if (!covers(rule.path, path)) continue;
    if (!best) {
      best = rule;
      continue;
    }
    // Longest pattern wins; on a tie, Allow does.
    if (rule.path.length > best.path.length) best = rule;
    else if (rule.path.length === best.path.length && rule.allow) best = rule;
  }
  return { allowed: best ? best.allow : true, rule: best };
}
