/**
 * Duplicate to-do detection (EI-346) — the decisions, kept free of SQLite and
 * the Durable Object so they can be tested with a fake `fetch`. The DO glue
 * (reading candidates, writing the flag through `push()`) is in `user-do.ts`.
 *
 * One Jev Noul per candidate: the new to-do goes in `state`, each existing
 * to-do in its own question's `instructions`. That is the documented dedupe
 * pattern (https://docs.typesafe.ai/primitives/noul.md), and unlike a Choice
 * over every candidate it can answer "none of them" — a Choice always ranks
 * something first. Questions in one request run in parallel, so many
 * candidates cost tokens, not latency.
 */

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Pinned rather than `jev-latest`, so a model update cannot silently move
 * the threshold below. Bump deliberately. */
export const JEV_MODEL = "jev-1.13.0";

/** A Noul at or above this is flagged. The docs' "confident yes" band; a
 * false flag costs the user one tap, a missed one costs nothing new. */
export const DUPLICATE_THRESHOLD = 0.8;
/** Questions per request. Far under the 32k state-plus-question budget even
 * with notes at `NOTES_MAX`. */
export const QUESTIONS_PER_REQUEST = 100;
/** How many open to-dos one check compares against, most recently updated
 * first. Past this an account is large enough that an old, untouched to-do
 * is not the one being re-typed. */
export const MAX_CANDIDATES = 300;
/** A push with more new to-dos than this is a bulk write (first sign-in
 * uploading a device's board, a seed, an import), not a person adding one,
 * and is not checked at all. */
export const MAX_NEW_TODOS_PER_PUSH = 3;
const NOTES_MAX = 300;
const TIMEOUT_MS = 10_000;

/** The node id every server-stamped HLC carries (`service/hlc.ts`). REST,
 * MCP and email creates all use it; a board create carries its device's. */
const SERVER_HLC_SUFFIX = ":server";

export interface TodoText {
  title: string;
  description: string | null;
}

export interface Candidate extends TodoText {
  id: string;
}

export interface NewTodoToCheck {
  id: string;
  /** Hold it off the board if flagged — true for a create from outside the
   * board. A board create stays visible (see `todoSchema.duplicateHeld`). */
  held: boolean;
}

export interface InsertedTodo {
  entityId: string;
  /** The fields this push applied — a create's whole row. */
  apply: Record<string, unknown>;
  hlcs: string[];
}

/**
 * Which of a push's newly inserted to-dos to check.
 *
 * Skips sub-tasks and recurring occurrences (an occurrence is its series
 * repeating, not a duplicate), anything not open, and the whole push when it
 * is a bulk write.
 */
export function selectNewTodosToCheck(inserted: InsertedTodo[]): NewTodoToCheck[] {
  const eligible = inserted.filter(({ apply }) => {
    const status = apply.status ?? "open";
    return (
      status === "open" &&
      apply.deletedAt == null &&
      apply.parentId == null &&
      apply.recurrenceParentId == null &&
      apply.duplicateOf == null &&
      typeof apply.title === "string" &&
      apply.title.trim() !== ""
    );
  });
  if (eligible.length > MAX_NEW_TODOS_PER_PUSH) return [];
  return eligible.map(({ entityId, hlcs }) => ({
    id: entityId,
    held: hlcs.length > 0 && hlcs.every((hlc) => hlc.endsWith(SERVER_HLC_SUFFIX)),
  }));
}

function describe(todo: TodoText): Record<string, string> {
  const notes = todo.description?.trim().slice(0, NOTES_MAX);
  return notes ? { title: todo.title, notes } : { title: todo.title };
}

/** One request's body. Question ids are positional (`c0`, `c1`, …) so they
 * map back to `candidates` by index. Dates are left out on purpose: Jev is
 * weak at them, and "same task" does not depend on them. */
export function buildJevRequest(newTodo: TodoText, candidates: Candidate[]) {
  return {
    model: JEV_MODEL,
    state: { new_todo: describe(newTodo) },
    questions: Object.fromEntries(
      candidates.map((candidate, i) => [
        `c${i}`,
        {
          type: "noul",
          instructions: {
            existing_todo: describe(candidate),
            question:
              "Is `new_todo` the same task as `existing_todo`, so that doing one would also complete the other?",
          },
          criteria: {
            true: "The same task, even if worded differently.",
            false: "A different task, or only a related or follow-up task.",
          },
        },
      ]),
    ),
  };
}

export class JevError extends Error {
  constructor(readonly status: number) {
    super(`Jev responded ${status}`);
    this.name = "JevError";
  }
}

interface JevResponse {
  answers?: Record<string, { noul?: number }>;
}

async function askJev(apiKey: string, body: unknown, fetchImpl: typeof fetch): Promise<JevResponse> {
  const response = await fetchImpl(JEV_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new JevError(response.status);
  return response.json();
}

/**
 * The candidate `newTodo` most probably duplicates, or null below
 * `DUPLICATE_THRESHOLD`. Throws on any Jev failure — the caller logs it and
 * flags nothing, which is the same outcome as "no duplicate".
 */
export async function findDuplicate(
  apiKey: string,
  newTodo: TodoText,
  candidates: Candidate[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; probability: number } | null> {
  const chunks: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += QUESTIONS_PER_REQUEST) {
    chunks.push(candidates.slice(i, i + QUESTIONS_PER_REQUEST));
  }
  const responses = await Promise.all(
    chunks.map((chunk) => askJev(apiKey, buildJevRequest(newTodo, chunk), fetchImpl)),
  );

  let best: { id: string; probability: number } | null = null;
  for (const [chunkIndex, response] of responses.entries()) {
    for (const [i, candidate] of chunks[chunkIndex].entries()) {
      const probability = response.answers?.[`c${i}`]?.noul;
      if (typeof probability !== "number" || probability < DUPLICATE_THRESHOLD) continue;
      if (!best || probability > best.probability) best = { id: candidate.id, probability };
    }
  }
  return best;
}

export type KeyCheck = "valid" | "invalid" | "unverified";

/**
 * A one-question request (about 20 tokens) to see whether Jev accepts the
 * key. 401/403 is a bad key. Anything else that fails — rate limit, overload,
 * network — says nothing about the key, so it is saved anyway and the user is
 * told it could not be checked.
 */
export async function checkJevKey(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  try {
    await askJev(
      apiKey,
      {
        model: JEV_MODEL,
        state: "Pick up frames for the concert posters.",
        questions: { is_task: { type: "noul", instructions: "Is this a task someone could do?" } },
      },
      fetchImpl,
    );
    return "valid";
  } catch (error) {
    if (error instanceof JevError && (error.status === 401 || error.status === 403)) return "invalid";
    return "unverified";
  }
}
