"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Assignee } from "@/lib/schema";

const EMPTY: ReadonlyMap<string, Assignee> = new Map();

const AssigneesContext = createContext<ReadonlyMap<string, Assignee>>(EMPTY);

/**
 * Hands the assignee rows to every card without threading a prop through the
 * eight places a card renders (EI-402). Provided once in `board.tsx`; outside
 * a provider (tests, the drag chip's tree) the map is empty and the card
 * simply shows no assignee chip.
 */
export function AssigneesProvider({
  assignees,
  children,
}: {
  assignees: readonly Assignee[];
  children: ReactNode;
}) {
  const byId = useMemo(() => new Map(assignees.map((a) => [a.id, a])), [assignees]);
  return <AssigneesContext.Provider value={byId}>{children}</AssigneesContext.Provider>;
}

export function useAssigneesById(): ReadonlyMap<string, Assignee> {
  return useContext(AssigneesContext);
}
