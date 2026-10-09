import { describe, expect, it, vi } from "vitest";
import {
  buildJevRequest,
  type Candidate,
  checkJevKey,
  findDuplicate,
  type InsertedTodo,
  JEV_ENDPOINT,
  MAX_NEW_TODOS_PER_PUSH,
  QUESTIONS_PER_REQUEST,
  selectNewTodosToCheck,
} from "./check";

const SERVER_HLC = "0199a1b2c3d4:0000:server";
const DEVICE_HLC = "0199a1b2c3d4:0000:device-1";

function inserted(id: string, apply: Record<string, unknown> = {}, hlcs = [SERVER_HLC]): InsertedTodo {
  return { entityId: id, apply: { title: "Pick up poster frames", status: "open", ...apply }, hlcs };
}

describe("selectNewTodosToCheck", () => {
  it("holds a server-stamped create and only flags a board create", () => {
    expect(selectNewTodosToCheck([inserted("a"), inserted("b", {}, [DEVICE_HLC])])).toEqual([
      { id: "a", held: true },
      { id: "b", held: false },
    ]);
  });

  it("skips sub-tasks, recurring occurrences, closed, deleted and blank to-dos", () => {
    expect(
      selectNewTodosToCheck([
        inserted("sub", { parentId: "p" }),
        inserted("occ", { recurrenceParentId: "r" }),
        inserted("done", { status: "done" }),
        inserted("gone", { deletedAt: "2026-10-08T00:00:00Z" }),
        inserted("blank", { title: "  " }),
      ]),
    ).toEqual([]);
  });

  it("skips the whole push when it is a bulk write", () => {
    const many = Array.from({ length: MAX_NEW_TODOS_PER_PUSH + 1 }, (_, i) => inserted(`t${i}`));
    expect(selectNewTodosToCheck(many)).toEqual([]);
  });
});

function candidates(count: number): Candidate[] {
  return Array.from({ length: count }, (_, i) => ({ id: `id-${i}`, title: `Task ${i}`, description: null }));
}

/** A fake Jev that answers each request's `c<i>` questions from `noulFor`. */
function fakeJev(noulFor: (title: string) => number) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as ReturnType<typeof buildJevRequest>;
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, q]) => [
        id,
        { type: "noul", noul: noulFor(q.instructions.existing_todo.title) },
      ]),
    );
    return Response.json({ model: "jev-1.13.0", answers });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const NEW_TODO = { title: "Pick up frames for posters", description: null };

describe("findDuplicate", () => {
  it("returns the most probable candidate at or above the threshold", async () => {
    const fetchImpl = fakeJev((title) => ({ "Task 3": 0.85, "Task 7": 0.93 })[title] ?? 0.05);
    expect(await findDuplicate("key", NEW_TODO, candidates(10), fetchImpl)).toEqual({
      id: "id-7",
      probability: 0.93,
    });
  });

  it("returns null when nothing reaches the threshold", async () => {
    const fetchImpl = fakeJev(() => 0.79);
    expect(await findDuplicate("key", NEW_TODO, candidates(5), fetchImpl)).toBeNull();
  });

  it("splits candidates into chunks and maps answers back across them", async () => {
    const last = QUESTIONS_PER_REQUEST + 4;
    const fetchImpl = fakeJev((title) => (title === `Task ${last}` ? 0.9 : 0));
    const result = await findDuplicate("key", NEW_TODO, candidates(last + 1), fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(JEV_ENDPOINT);
    expect(result).toEqual({ id: `id-${last}`, probability: 0.9 });
  });

  it("throws on a Jev error so the caller flags nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(findDuplicate("key", NEW_TODO, candidates(2), fetchImpl)).rejects.toThrow("429");
  });
});

describe("buildJevRequest", () => {
  it("sends notes only when there are some, truncated", () => {
    const body = buildJevRequest({ title: "New", description: "x".repeat(1000) }, [
      { id: "a", title: "Old", description: "  " },
    ]);
    expect(body.state.new_todo.notes).toHaveLength(300);
    expect(body.questions.c0.instructions.existing_todo).toEqual({ title: "Old" });
  });
});

describe("checkJevKey", () => {
  const respond = (status: number) =>
    vi.fn(async () => Response.json({ answers: {} }, { status })) as unknown as typeof fetch;

  it("reads 401 and 403 as a bad key", async () => {
    expect(await checkJevKey("k", respond(401))).toBe("invalid");
    expect(await checkJevKey("k", respond(403))).toBe("invalid");
  });

  it("reads a busy or unreachable service as unverified, not invalid", async () => {
    expect(await checkJevKey("k", respond(529))).toBe("unverified");
    const offline = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await checkJevKey("k", offline)).toBe("unverified");
  });

  it("accepts a 200", async () => {
    expect(await checkJevKey("k", respond(200))).toBe("valid");
  });
});
