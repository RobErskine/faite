"use client";

import dynamic from "next/dynamic";

/**
 * The board is client-only by design.
 *
 * It renders entirely from IndexedDB, which does not exist on the server, so
 * there is nothing meaningful to server-render. Keeping it out of SSR is also
 * what keeps the `output: export` build (the Capacitor target) working.
 *
 * Not gated behind auth — see `docs/ARCHITECTURE.md` §2.13. Anyone can open
 * this route and start using it against local data; signing in is what makes
 * that data durable and, at P3, synced.
 */
const Board = dynamic(
  () => import("@/components/board/board").then((m) => m.Board),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading your board…
      </div>
    ),
  },
);

export default function BoardPage() {
  return <Board />;
}
