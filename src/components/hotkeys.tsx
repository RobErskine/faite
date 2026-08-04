"use client";

import { useHotkeys as useLibHotkeys } from "react-hotkeys-hook";
import {
  hasExactModifiers,
  isEligible,
  type GuardContext,
  type Hotkey,
} from "@/lib/keyboard";

/**
 * Binds the hotkey registry to the keyboard.
 *
 * A component rather than a hook, because one library `useHotkeys` call is
 * needed per entry and React forbids calling hooks in a loop. Rendering one
 * child per hotkey, keyed by id, gives each its own call site — which is also
 * what lets the registry grow without touching this file.
 *
 * The library owns combo parsing, the `mod` alias, and matching on physical
 * key CODES rather than produced characters (its v5 default), which is what
 * keeps ⌘Z working on non-QWERTY layouts. Everything app-specific — which
 * shortcuts may fire while dragging, in a text field, or behind a modal —
 * stays here. See docs/KEYBOARD.md §4.
 */
export function Hotkeys({
  registry,
  context,
}: {
  registry: Hotkey[];
  context: GuardContext;
}) {
  return (
    <>
      {registry.map((hotkey) => (
        <HotkeyBinding key={hotkey.id} hotkey={hotkey} context={context} />
      ))}
    </>
  );
}

function HotkeyBinding({
  hotkey,
  context,
}: {
  hotkey: Hotkey;
  context: GuardContext;
}) {
  useLibHotkeys(
    hotkey.combo,
    (event) => {
      /**
       * Reject extra modifiers ourselves.
       *
       * Whether the library fires "mod+z" for ⇧⌘Z is undocumented, and the
       * failure is silent and bad: pressing redo would perform an undo. This
       * check makes the answer ours regardless of what the dependency does.
       */
      if (!hasExactModifiers(hotkey.combo, event)) return;
      hotkey.run();
    },
    {
      enabled: isEligible(hotkey, context),
      // Text fields own their keystrokes unless a shortcut opts in.
      enableOnFormTags: hotkey.allowInTextEntry ?? false,
      enableOnContentEditable: hotkey.allowInTextEntry ?? false,
      preventDefault: true,
    },
    // `run` closes over fresh props each render, so the binding must be
    // rebuilt when it changes or the handler would call a stale closure.
    [hotkey.run, hotkey.combo],
  );

  return null;
}
