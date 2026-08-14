<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Keyboard shortcuts

Any new keyboard shortcut — global or local — must be registered in
`src/lib/shortcuts.ts` (a global entry is derived automatically from the
`Hotkey[]` registry in `use-board-ui-state.ts`; a local one needs a hand-added
`LOCAL_SHORTCUTS` entry with a `source`) and reflected in `docs/KEYBOARD.md`
§1. The `?` help sheet and the `⌘K` palette both read from `shortcuts.ts` —
a shortcut left out of it is invisible to users who go looking for it. See
`docs/KEYBOARD.md` §5 for the full recipe.
