// The release workflows, checked for the two mistakes that have each been made
// twice now.
//
// Neither has a symptom until a tag is already pushed and something has half
// published, and neither is visible in a diff — one is an absent line, the
// other is a glob that looks correct. There is no YAML parser here (the tool
// has no dependencies and this suite runs on a bare machine), so these read the
// text. That is enough: both are about a line being present and well-formed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../.github/workflows/', import.meta.url);
const workflows = readdirSync(dir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }));

test('there are workflows to check', () => {
  assert.ok(workflows.length >= 3, `only found ${workflows.length} workflow files`);
});

test('a tag trigger names version tags, never a bare v*', () => {
  // `v1` floats forward with every backwards-compatible release, so `v*` matches
  // it. Force-pushing v1 then starts a second, full build of a release that does
  // not exist — fifteen minutes to fail, on every compatible release forever.
  // mac-release.yml and npm-publish.yml both carry a comment about this. The
  // desktop workflow was written with `v*` anyway.
  const wrong = [];
  for (const { name, text } of workflows) {
    for (const [, list] of text.matchAll(/^\s*tags:\s*(\[[^\]]*\]|.*)$/gm)) {
      if (/v\*/.test(list)) wrong.push(`${name}: tags: ${list.trim()}`);
    }
  }
  assert.deepEqual(wrong, [],
    'a bare v* matches the floating v1 tag: ' + wrong.join(', ') +
    ". Use 'v[0-9]+.[0-9]+.[0-9]+', the shape the other release workflows use.");
});

test('a workflow that writes to a release asks for permission to', () => {
  // Without `contents: write` the token is read-only and `gh release upload`
  // fails with "HTTP 403: Resource not accessible by integration" — after the
  // bundles have been built, installed and run, twenty minutes in, on a release
  // that is already public and now incomplete.
  const missing = [];
  for (const { name, text } of workflows) {
    const writes = /gh release (upload|create|edit|delete)/.test(text);
    if (!writes) continue;
    if (!/^\s*contents:\s*write\s*$/m.test(text)) missing.push(name);
  }
  assert.deepEqual(missing, [],
    `${missing.join(', ')} writes to a release but never asks for contents: write. ` +
    'The token is read-only by default, so the upload fails with a 403 after the ' +
    'build has already succeeded.');
});
