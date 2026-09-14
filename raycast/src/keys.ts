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

/** Open Extension Preferences: ⌘, on a Mac, and no shortcut on Windows.
 *
 *  Raycast for Windows keeps Ctrl+, for its own settings, so an action bound
 *  to it never fires. The first person to test this on Windows reached the
 *  preferences through Ctrl+K instead, which is where they still are. No other
 *  key is offered there: nobody would guess one, and the action menu finds the
 *  action by name. */
export const preferences: Keyboard.Shortcut | undefined =
  process.platform === "win32" ? undefined : primary(",");
