"use client";

import dynamic from "next/dynamic";

/**
 * The board is client-only by design.
 *
 * It renders entirely from IndexedDB, which does not exist on the server, so
 * there is nothing meaningful to server-render. Keeping it out of SSR is also
 * what keeps the `output: export` build (the Capacitor target) working.
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

export default function Home() {
  return <Board />;
}
