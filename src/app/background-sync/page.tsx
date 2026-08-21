"use client";

import { SyncProvider } from "@/components/sync/sync-provider";

/**
 * D2b — the hidden background webview's entire purpose (docs/DESKTOP.md's
 * D2b section; design rationale in docs/DESKTOP-SYNC-TIMER-SPIKE.md).
 *
 * Deliberately NOT the real board (`board.html`) reused hidden. A hidden
 * window's own `setInterval` dies after one tick (the spike's whole
 * finding), so this window's job is only to exist as a place Rust can
 * `eval()` into — `SyncProvider` still needs the real Dexie/session-backed
 * sync engine, but nothing here needs `DndContext`, keyboard shortcuts, or
 * `DesktopAuthProvider`'s deep-link listener. The last one specifically:
 * `onOpenUrl` is an app-wide event, not scoped to one webview, so mounting
 * `DesktopAuthProvider` here too would race the main window to handle the
 * same `faite://auth-callback` URL. One window listens for that; this one
 * only syncs.
 */
export default function BackgroundSyncPage() {
  return <SyncProvider />;
}
