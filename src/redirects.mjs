// Redirect maps, checked against the live site.
//
// A migration's redirect map is written once, verified once, and then rots
// quietly: a later change to the destination turns an entry into a hop through
// a 404, and nothing tells anyone. The old URLs are the ones with the links and
// the rankings, so this is one of the few SEO failures that is expensive and
// completely silent.
//
// Reads the Netlify `_redirects` shape, which is also the simplest thing
// anyone writes by hand:
//
//   /old-path   /new-path   301
//   /also-old   /new-path          # status optional
//   /just-a-list-of-old-urls       # destination optional too
//
// A rule with a wildcard or a placeholder cannot be tested by asking for it
// literally, so those are counted and reported rather than guessed at.

const HAS_PATTERN = /[*:]/;

/** Rules from a redirect map. `to` and `status` may be null. */
export function parseRedirectMap(text) {
  const rules = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [from, to, status] = line.split(/\s+/);
    if (!from) continue;
    rules.push({
      from,
      to: to ?? null,
      // Netlify writes `301!` to force a rule ahead of an existing file.
      status: status ? Number(status.replace('!', '')) || null : null,
    });
  }
  return rules;
}

const f = (level, id, title, detail, url) => ({ level, id, title, detail, url });

const bare = (u) => (u ?? '').replace(/\/$/, '');

/**
 * Ask the live site for every old URL and report what actually happens.
 *
 * Findings are aggregated by outcome: a migration map runs to hundreds of
 * entries, and one finding per entry would be a wall nobody reads. Each one
 * names the first few and says how many more there are.
 */
export async function redirectChecks(rules, fetcher, origin, { limit = 200, onProgress } = {}) {
  const out = [];
  if (!rules.length) return out;

  const patterned = rules.filter((r) => HAS_PATTERN.test(r.from));
  const testable = rules.filter((r) => !HAS_PATTERN.test(r.from));
  const checked = testable.slice(0, limit);

  if (patterned.length) {
    out.push(f('info', 'redirect-pattern-skipped', `${patterned.length} wildcard rule(s) were not tested`,
      `Rules like ${patterned.slice(0, 2).map((r) => r.from).join(', ')} match a shape rather than a URL, ` +
        'so asking for them literally proves nothing. Add a real example of each to the map, or test them by hand.',
      origin));
  }
  if (testable.length > checked.length) {
    out.push(f('info', 'redirect-map-capped', `${testable.length - checked.length} rule(s) were not tested`,
      `The map has ${testable.length} testable rules and the limit is ${limit}. Raise it with maxRedirectChecks.`,
      origin));
  }

  const results = await Promise.all(
    checked.map(async (rule) => {
      let from;
      try {
        from = new URL(rule.from, origin).toString();
      } catch {
        return null;
      }
      const { hops, final } = await fetcher.chain(from);
      onProgress?.({ phase: 'redirects', status: hops[0]?.status ?? 0, url: rule.from, detail: `→ ${final.url}` });
      return { rule, from, hops, final, first: hops[0]?.status ?? 0 };
    }),
  );

  const buckets = new Map();
  const add = (key, line) => buckets.set(key, [...(buckets.get(key) ?? []), line]);

  for (const r of results.filter(Boolean)) {
    const { rule, from, hops, final, first } = r;

    if (first === 404 || first === 410 || first === 0) {
      add('gone', `${rule.from} → ${first || final.error}`);
      continue;
    }
    if (first >= 200 && first < 300) {
      add('notRedirecting', `${rule.from} answers ${first}`);
      continue;
    }
    // It redirects. Does it arrive somewhere real, and in one hop?
    if (!final.ok) {
      add('broken', `${rule.from} → ${final.url} (${final.status || final.error})`);
      continue;
    }
    // hops includes the final response, so two entries is one redirect.
    if (hops.length > 2) {
      add('hops', `${rule.from} takes ${hops.length - 1} hops → ${final.url}`);
    }
    if (rule.status === 301 && first === 302) {
      add('temporary', `${rule.from} answers 302 where the map says 301`);
    }
    if (rule.to && !HAS_PATTERN.test(rule.to)) {
      let expected;
      try {
        expected = new URL(rule.to, origin).toString();
      } catch {
        expected = null;
      }
      if (expected && bare(expected) !== bare(final.url)) {
        add('elsewhere', `${rule.from} → ${final.url}, map says ${rule.to}`);
      }
    }
  }

  const say = (key, level, id, title, detail) => {
    const lines = buckets.get(key);
    if (!lines?.length) return;
    const shown = lines.slice(0, 3).join('; ');
    out.push(f(level, id, title(lines.length),
      `${shown}${lines.length > 3 ? `, and ${lines.length - 3} more` : ''}. ${detail}`, origin));
  };

  say('gone', 'error', 'redirect-dead', (n) => `${n} old URL(s) in the redirect map are simply gone`,
    'The rule is not in effect, so every link and every ranking pointing at these lands on nothing.');
  say('broken', 'error', 'redirect-broken', (n) => `${n} redirect(s) land on a page that does not load`,
    'The rule fires and then arrives nowhere, which is worse than no rule: it looks handled.');
  say('notRedirecting', 'warn', 'redirect-not-applied', (n) => `${n} old URL(s) answer 200 instead of redirecting`,
    'The map says these moved, and the server disagrees. Either the rule never shipped or something serves the old path.');
  say('hops', 'warn', 'redirect-hops', (n) => `${n} redirect(s) take more than one hop`,
    'Each hop is a round trip a visitor and a crawler both pay for. Point the first rule at the final URL.');
  say('elsewhere', 'warn', 'redirect-elsewhere', (n) => `${n} redirect(s) land somewhere the map does not expect`,
    'Another rule is probably matching first. The map is no longer describing what the site does.');
  say('temporary', 'warn', 'redirect-temporary', (n) => `${n} permanent redirect(s) are served as 302`,
    'A 302 tells Google the move is temporary, so it keeps the old URL indexed and passes less through it.');

  return out;
}
