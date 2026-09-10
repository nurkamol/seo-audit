// Shortcuts that exist on both platforms.
//
// Raycast drops a shortcut written as `{ modifiers: ["cmd"], … }` on Windows
// without a word — the action is still there, and the key somebody learnt from
// the README does nothing. Every shortcut in this extension is either one of
// Raycast's Common ones, which are already per-platform, or goes through here.
// `test/raycast.test.mjs` fails on a bare one.

import { Keyboard } from "@raycast/api";

/** ⌘ on a Mac, Ctrl on Windows. */
export const primary = (key: Keyboard.KeyEquivalent): Keyboard.Shortcut => ({
  macOS: { modifiers: ["cmd"], key },
  Windows: { modifiers: ["ctrl"], key },
});
