import { beforeEach, describe, expect, it, vi } from "vitest";

// The auth seam. `handleV1Request` calls `createAuth(env, request)` — which
// needs a live D1 — and hands the result to `authorizeScope`. Mocking both
// leaves the ENTIRE rest of the dispatch real: routing, status codes,
// sequencing, and the push batch. `vi.mock` is hoisted above imports, which
// is why this cannot live in `test-harness.ts`.
vi.mock("../auth", () => ({ createAuth: vi.fn(() => ({})) }));
vi.mock("../auth-scopes", () => ({ authorizeScope: vi.fn() }));

import { authorizeScope } from "../auth-scopes";
import { handleV1Request } from "./routes";
import {
  makeEnv,
  makeStub,
  pushedEntries,
  rawLabelRow,
  rawListRow,
  rawTabRow,
  rawTodoRow,
  v1Request,
  type FakeStub,
} from "./test-harness";

const authorize = vi.mocked(authorizeScope);

/** The scope each call demanded, in order — this is what turns "does DELETE
 * require write" into a real assertion rather than a hopeful comment. */
const demandedScopes = () => authorize.mock.calls.map((call) => call[2]);

let stub: FakeStub;
let env: CloudflareEnv;

beforeEach(() => {
  vi.clearAllMocks();
  stub = makeStub();
  env = makeEnv(stub);
  authorize.mockResolvedValue({ ok: true, userId: "user-1" });
});

describe("scope gating", () => {
  it.each([
    ["GET", "/api/v1/todos", "read"],
    ["GET", "/api/v1/lists", "read"],
    ["GET", "/api/v1/todos/todo-1", "read"],
    ["POST", "/api/v1/todos", "write"],
    ["PATCH", "/api/v1/todos/todo-1", "write"],
    ["DELETE", "/api/v1/todos/todo-1", "write"],
  ])("%s %s demands the %s scope", async (method, path, scope) => {
    stub.getTodo.mockResolvedValue(rawTodoRow());

    await handleV1Request(
      v1Request(method, path, method === "GET" || method === "DELETE" ? undefined : { title: "x" }),
      env,
    );

    expect(demandedScopes()).toEqual([scope]);
  });

  it("propagates 401 and 403 verbatim, and never reaches the store", async () => {
    authorize.mockResolvedValue({ ok: false, status: 403, error: "insufficient-scope" });

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/todos/todo-1"), env);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "insufficient-scope" });
    expect(stub.push).not.toHaveBeenCalled();
    expect(stub.getTodo).not.toHaveBeenCalled();
  });
});

describe("GET collections", () => {
  it("returns each row through its own Zod schema", async () => {
    stub.listEntities.mockResolvedValue([rawTodoRow()]);

    const res = await handleV1Request(v1Request("GET", "/api/v1/todos"), env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject([{ id: "todo-1", title: "Buy milk" }]);
  });

  /**
   * REGRESSION. `routes.ts`'s header claims `schema.parse()` strips `version`
   * — the DO-only SQLite column — by virtue of never declaring it, rather
   * than by a hand-picked field list. The fake stub returns rows WITH
   * `version` (as the real `listEntities` does) so that claim is enforced.
   */
  it("never leaks the DO's internal version column", async () => {
    stub.listEntities.mockResolvedValue([rawTodoRow({ version: 99 })]);

    const res = await handleV1Request(v1Request("GET", "/api/v1/todos"), env);
    const [todo] = (await res.json()) as Record<string, unknown>[];

    expect(todo).not.toHaveProperty("version");
  });

  it("serves every resource in the map", async () => {
    for (const path of ["todos", "lists", "labels", "tabs", "attachments"]) {
      const res = await handleV1Request(v1Request("GET", `/api/v1/${path}`), env);
      expect(res.status).toBe(200);
    }
  });
});

describe("GET /api/v1/todos filters", () => {
  beforeEach(() => {
    stub.listEntities.mockResolvedValue([
      rawTodoRow({ id: "a", status: "open" }),
      rawTodoRow({ id: "b", status: "done" }),
    ]);
  });

  const ids = async (res: Response) =>
    ((await res.json()) as { id: string }[]).map((t) => t.id);

  it("applies a status filter", async () => {
    const res = await handleV1Request(v1Request("GET", "/api/v1/todos?status=open"), env);
    await expect(ids(res)).resolves.toEqual(["a"]);
  });

  it("returns everything when no filter is given", async () => {
    const res = await handleV1Request(v1Request("GET", "/api/v1/todos"), env);
    await expect(ids(res)).resolves.toEqual(["a", "b"]);
  });

  it("400s on a malformed filter rather than ignoring it", async () => {
    const res = await handleV1Request(v1Request("GET", "/api/v1/todos?status=nonsense"), env);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid-request" });
  });

  it("does not apply todo filters to other resources", async () => {
    // `?status=` is meaningless on lists; it must not 400 them. Reset the
    // suite's todo rows first — this route parses with `listSchema`.
    stub.listEntities.mockResolvedValue([]);

    const res = await handleV1Request(v1Request("GET", "/api/v1/lists?status=nonsense"), env);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/todos/{id}", () => {
  it("returns the todo, not the collection", async () => {
    stub.getTodo.mockResolvedValue(rawTodoRow());

    const res = await handleV1Request(v1Request("GET", "/api/v1/todos/todo-1"), env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: "todo-1" });
    // Dispatch check: the item route must not fall through to `listEntities`.
    expect(stub.listEntities).not.toHaveBeenCalled();
  });

  it("404s for an unknown or tombstoned id", async () => {
    const res = await handleV1Request(v1Request("GET", "/api/v1/todos/nope"), env);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not-found" });
  });
});

describe("POST /api/v1/todos", () => {
  it("201s, and resolves position + reminderTime from the store", async () => {
    stub.nextTodoPosition.mockResolvedValue("a5");
    stub.defaultReminderTimeForList.mockResolvedValue("09:00");
    stub.getTodo.mockResolvedValue(rawTodoRow({ position: "a5", reminderTime: "09:00" }));

    const res = await handleV1Request(v1Request("POST", "/api/v1/todos", { title: "New" }), env);

    expect(res.status).toBe(201);
    expect(stub.push).toHaveBeenCalledTimes(1);
    expect(pushedEntries(stub)[0].patch).toMatchObject({ position: "a5", reminderTime: "09:00" });
  });

  /**
   * REGRESSION (EI-308). `defaultReminderTimeForList` was never called: the
   * route tested `parsed.reminderTime !== undefined`, but `.default(null)` on
   * the schema means an omitted key parses to `null`, never `undefined`. So a
   * todo created in a list with a default reminder silently got none — the
   * exact parity gap A5 claimed to close. Key presence on the raw body is the
   * only thing that can tell "omitted" from "explicitly null".
   */
  it("REGRESSION: resolves the list default when reminderTime is omitted", async () => {
    stub.defaultReminderTimeForList.mockResolvedValue("09:00");
    stub.getTodo.mockResolvedValue(rawTodoRow());

    await handleV1Request(
      v1Request("POST", "/api/v1/todos", { title: "New", listId: "list-1" }),
      env,
    );

    expect(stub.defaultReminderTimeForList).toHaveBeenCalledWith("list-1");
    expect(pushedEntries(stub)[0].patch).toMatchObject({ reminderTime: "09:00" });
  });

  it("REGRESSION: an explicit null means no reminder, not the list default", async () => {
    stub.defaultReminderTimeForList.mockResolvedValue("09:00");
    stub.getTodo.mockResolvedValue(rawTodoRow());

    await handleV1Request(
      v1Request("POST", "/api/v1/todos", { title: "New", listId: "list-1", reminderTime: null }),
      env,
    );

    expect(stub.defaultReminderTimeForList).not.toHaveBeenCalled();
    expect(pushedEntries(stub)[0].patch).toMatchObject({ reminderTime: null });
  });

  it("an explicit time wins over the list default", async () => {
    stub.defaultReminderTimeForList.mockResolvedValue("09:00");
    stub.getTodo.mockResolvedValue(rawTodoRow());

    await handleV1Request(
      v1Request("POST", "/api/v1/todos", { title: "New", reminderTime: "17:30" }),
      env,
    );

    expect(stub.defaultReminderTimeForList).not.toHaveBeenCalled();
    expect(pushedEntries(stub)[0].patch).toMatchObject({ reminderTime: "17:30" });
  });

  it("400s on a body with no title, without pushing", async () => {
    const res = await handleV1Request(v1Request("POST", "/api/v1/todos", { description: "x" }), env);

    expect(res.status).toBe(400);
    expect(stub.push).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/todos/{id}", () => {
  it("200s and pushes only the named field", async () => {
    stub.getTodo.mockResolvedValue(rawTodoRow());

    const res = await handleV1Request(
      v1Request("PATCH", "/api/v1/todos/todo-1", { status: "done" }),
      env,
    );

    expect(res.status).toBe(200);
    expect(Object.keys(pushedEntries(stub)[0].patch).sort()).toEqual(["status", "updatedAt"]);
  });

  it("404s BEFORE pushing, so a patch never insert-creates a ghost row", async () => {
    const res = await handleV1Request(
      v1Request("PATCH", "/api/v1/todos/nope", { status: "done" }),
      env,
    );

    expect(res.status).toBe(404);
    expect(stub.push).not.toHaveBeenCalled();
  });

  it("400s on an empty patch", async () => {
    stub.getTodo.mockResolvedValue(rawTodoRow());

    const res = await handleV1Request(v1Request("PATCH", "/api/v1/todos/todo-1", {}), env);

    expect(res.status).toBe(400);
    expect(stub.push).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/todos/{id}", () => {
  it("204s with no body", async () => {
    stub.getTodo.mockResolvedValue(rawTodoRow());

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/todos/todo-1"), env);

    expect(res.status).toBe(204);
    await expect(res.text()).resolves.toBe("");
  });

  it("404s BEFORE pushing", async () => {
    const res = await handleV1Request(v1Request("DELETE", "/api/v1/todos/nope"), env);

    expect(res.status).toBe(404);
    expect(stub.push).not.toHaveBeenCalled();
  });

  /**
   * The invariant with no other guard. Children, attachment tombstones, the
   * `deleted` event and the todo's own tombstone must reach the DO in ONE
   * push, so they apply in one `transactionSync`. Splitting the call would
   * still pass every other test here while quietly losing atomicity.
   */
  it("sends children, attachments, the event and the tombstone in ONE push", async () => {
    stub.getTodo.mockResolvedValue(rawTodoRow());
    stub.childTodoIds.mockResolvedValue(["child-1", "child-2"]);
    stub.attachmentIdsForTodo.mockResolvedValue(["att-1"]);

    await handleV1Request(v1Request("DELETE", "/api/v1/todos/todo-1"), env);

    expect(stub.push).toHaveBeenCalledTimes(1);

    const entries = pushedEntries(stub);
    expect(entries).toHaveLength(5);
    expect(entries.filter((e) => e.kind === "todoEvent")).toHaveLength(1);
    expect(entries.filter((e) => e.kind === "attachment")).toHaveLength(1);
    // Children are orphaned, not tombstoned.
    const children = entries.filter((e) => e.kind === "todo" && e.entityId !== "todo-1");
    expect(children.map((e) => e.patch)).toEqual([
      expect.objectContaining({ parentId: null }),
      expect.objectContaining({ parentId: null }),
    ]);
  });

  it("pre-fetches enough HLC stamps for the whole batch", async () => {
    // `durableHlcQueue` throws if a builder outruns the stamps it pre-fetched,
    // so an under-count would surface as a 500 rather than a wrong write.
    stub.getTodo.mockResolvedValue(rawTodoRow());
    stub.childTodoIds.mockResolvedValue(["c1", "c2", "c3"]);
    stub.attachmentIdsForTodo.mockResolvedValue(["a1", "a2"]);

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/todos/todo-1"), env);

    expect(res.status).toBe(204);
    expect(stub.nextServerHlc.mock.calls.length).toBeGreaterThanOrEqual(7);
  });

  it("500s when the DO rejects the batch, rather than reporting success", async () => {
    stub.getTodo.mockResolvedValue(rawTodoRow());
    stub.push.mockResolvedValue({
      acked: [],
      rejected: [{ id: "e1", reason: "nope" }],
      highestVersion: 1,
      conflicts: [],
    });

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/todos/todo-1"), env);
    expect(res.status).toBe(500);
  });
});

describe("dispatch edges", () => {
  it("404s an unknown resource", async () => {
    const res = await handleV1Request(v1Request("GET", "/api/v1/nonsense"), env);
    expect(res.status).toBe(404);
  });

  it("404s a method the route does not implement", async () => {
    const res = await handleV1Request(v1Request("DELETE", "/api/v1/lists"), env);
    expect(res.status).toBe(404);
  });

  it("answers OPTIONS as a preflight, without authenticating", async () => {
    const res = await handleV1Request(v1Request("OPTIONS", "/api/v1/todos"), env);

    expect(res.status).toBe(204);
    expect(authorize).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION (EI-307). The preflight advertised only `GET, POST, OPTIONS`,
   * so a cross-origin browser client — including Scalar's "try it" on
   * `/docs` — was blocked from every write method. PATCH has been missing
   * since A5; DELETE since A13.
   */
  it("advertises every method /api/v1 actually implements", async () => {
    const res = await handleV1Request(v1Request("OPTIONS", "/api/v1/todos"), env);
    const allowed = res.headers.get("Access-Control-Allow-Methods") ?? "";

    for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
      expect(allowed).toContain(method);
    }
  });

  it("500s rather than leaking an exception when the store throws", async () => {
    stub.listEntities.mockRejectedValue(new Error("boom"));

    const res = await handleV1Request(v1Request("GET", "/api/v1/todos"), env);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "internal-error" });
  });
});

describe("POST /api/v1/lists", () => {
  beforeEach(() => {
    stub.listEntities.mockResolvedValue([rawTabRow()]);
    stub.getEntity.mockResolvedValue(rawListRow());
  });

  it("201s, resolving position from the store and tabId from the default tab", async () => {
    stub.nextPosition.mockResolvedValue("a9");

    const res = await handleV1Request(v1Request("POST", "/api/v1/lists", { name: "Errands" }), env);

    expect(res.status).toBe(201);
    expect(stub.nextPosition).toHaveBeenCalledWith("list");
    expect(pushedEntries(stub)[0].patch).toMatchObject({
      name: "Errands",
      position: "a9",
      tabId: "tab-1",
      isBacklog: false,
    });
  });

  it("honours an explicit tabId over the default", async () => {
    await handleV1Request(
      v1Request("POST", "/api/v1/lists", { name: "Work", tabId: "tab-9" }),
      env,
    );
    expect(pushedEntries(stub)[0].patch).toMatchObject({ tabId: "tab-9" });
  });

  /** `isBacklog` is not in the create mask — a caller naming it must not get
   * a second backlog. */
  it("ignores a client-supplied isBacklog", async () => {
    await handleV1Request(
      v1Request("POST", "/api/v1/lists", { name: "Fake", isBacklog: true }),
      env,
    );
    expect(pushedEntries(stub)[0].patch).toMatchObject({ isBacklog: false });
  });

  it("400s without a name, and does not push", async () => {
    const res = await handleV1Request(v1Request("POST", "/api/v1/lists", { color: "red" }), env);
    expect(res.status).toBe(400);
    expect(stub.push).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/lists/{id}", () => {
  /**
   * REGRESSION. Every `listSchema` field carries a `.default()`, so a static
   * `.partial()` mask would expand a rename into a patch that also clears
   * color/tab/archive AND sets `isBacklog: false`. On the Backlog list that
   * leaves the account with no backlog, `deleteList`'s guard permanently
   * disarmed, and homeless todos with nowhere to land.
   */
  it("REGRESSION: a rename does not expand to isBacklog or any other default", async () => {
    stub.getEntity.mockResolvedValue(rawListRow());

    const res = await handleV1Request(
      v1Request("PATCH", "/api/v1/lists/list-1", { name: "Renamed" }),
      env,
    );

    expect(res.status).toBe(200);
    const patch = pushedEntries(stub)[0].patch as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(["name", "updatedAt"]);
    expect(patch).not.toHaveProperty("isBacklog");
    expect(patch).not.toHaveProperty("tabId");
  });

  it("drops server-owned fields rather than honouring them", async () => {
    stub.getEntity.mockResolvedValue(rawListRow());

    await handleV1Request(
      v1Request("PATCH", "/api/v1/lists/list-1", {
        name: "Renamed",
        isBacklog: true,
        archivedWithTabId: "tab-9",
        deletedAt: "2026-01-01T00:00:00.000Z",
      }),
      env,
    );

    expect(Object.keys(pushedEntries(stub)[0].patch).sort()).toEqual(["name", "updatedAt"]);
  });

  it("allows archivedAt, which is a real user action", async () => {
    stub.getEntity.mockResolvedValue(rawListRow());

    await handleV1Request(
      v1Request("PATCH", "/api/v1/lists/list-1", { archivedAt: "2026-09-08T00:00:00.000Z" }),
      env,
    );

    expect(pushedEntries(stub)[0].patch).toMatchObject({
      archivedAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("404s before pushing, and 400s an empty patch", async () => {
    const missing = await handleV1Request(
      v1Request("PATCH", "/api/v1/lists/nope", { name: "x" }),
      env,
    );
    expect(missing.status).toBe(404);
    expect(stub.push).not.toHaveBeenCalled();

    stub.getEntity.mockResolvedValue(rawListRow());
    const empty = await handleV1Request(v1Request("PATCH", "/api/v1/lists/list-1", {}), env);
    expect(empty.status).toBe(400);
    expect(stub.push).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/lists/{id}", () => {
  it("rehomes its todos to Backlog and tombstones the list in ONE push", async () => {
    stub.getEntity.mockResolvedValue(rawListRow());
    stub.todoIdsInList.mockResolvedValue(["t1", "t2"]);
    stub.backlogListId.mockResolvedValue("backlog-1");

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/lists/list-1"), env);

    expect(res.status).toBe(204);
    expect(stub.push).toHaveBeenCalledTimes(1);

    const entries = pushedEntries(stub);
    expect(entries).toHaveLength(3);
    expect(entries.slice(0, 2).map((e) => e.patch)).toEqual([
      expect.objectContaining({ listId: "backlog-1" }),
      expect.objectContaining({ listId: "backlog-1" }),
    ]);
    expect(entries[2]).toMatchObject({
      kind: "list",
      entityId: "list-1",
      patch: expect.objectContaining({ deletedAt: expect.any(String) }),
    });
  });

  /** Backlog is the destination those todos move to — deleting it would leave
   * the next delete with nowhere to rehome. */
  it("409s on the Backlog list, without pushing", async () => {
    stub.getEntity.mockResolvedValue(rawListRow({ isBacklog: true }));

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/lists/list-1"), env);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "backlog-not-deletable" });
    expect(stub.push).not.toHaveBeenCalled();
  });

  /** Chunking would silently lose transactionSync atomicity, so refuse loudly
   * instead of splitting the batch. */
  it("409s rather than splitting a batch too large to write atomically", async () => {
    stub.getEntity.mockResolvedValue(rawListRow());
    stub.todoIdsInList.mockResolvedValue(Array.from({ length: 451 }, (_, i) => `t${i}`));

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/lists/list-1"), env);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "too-many-dependents" });
    expect(stub.push).not.toHaveBeenCalled();
  });

  it("404s an unknown list before pushing", async () => {
    const res = await handleV1Request(v1Request("DELETE", "/api/v1/lists/nope"), env);
    expect(res.status).toBe(404);
    expect(stub.push).not.toHaveBeenCalled();
  });
});

describe("list scope gating", () => {
  it.each([
    ["GET", "/api/v1/lists/list-1", "read"],
    ["POST", "/api/v1/lists", "write"],
    ["PATCH", "/api/v1/lists/list-1", "write"],
    ["DELETE", "/api/v1/lists/list-1", "write"],
  ])("%s %s demands %s", async (method, path, scope) => {
    stub.getEntity.mockResolvedValue(rawListRow());
    stub.listEntities.mockResolvedValue([rawTabRow()]);

    await handleV1Request(
      v1Request(method, path, method === "GET" || method === "DELETE" ? undefined : { name: "x" }),
      env,
    );

    expect(authorize.mock.calls.map((c) => c[2])).toEqual([scope]);
  });
});

describe("labels CRUD", () => {
  it("POST 201s with a server-resolved position", async () => {
    stub.nextPosition.mockResolvedValue("a4");
    stub.getEntity.mockResolvedValue(rawLabelRow());

    const res = await handleV1Request(v1Request("POST", "/api/v1/labels", { name: "Urgent" }), env);

    expect(res.status).toBe(201);
    expect(stub.nextPosition).toHaveBeenCalledWith("label");
    expect(pushedEntries(stub)[0].patch).toMatchObject({ name: "Urgent", position: "a4" });
  });

  it("PATCH does not clear the decoration it did not mention", async () => {
    stub.getEntity.mockResolvedValue(rawLabelRow({ emoji: "🔥" }));

    await handleV1Request(v1Request("PATCH", "/api/v1/labels/label-1", { color: "blue" }), env);

    expect(Object.keys(pushedEntries(stub)[0].patch).sort()).toEqual(["color", "updatedAt"]);
  });

  /**
   * A label is multi-assign, so it cannot be rehomed the way a list's todos
   * are — it is STRIPPED from every todo carrying it. One push, so no client
   * ever sees a todo referencing a label that is already gone.
   */
  it("DELETE strips itself from every referencing todo, in ONE push", async () => {
    stub.getEntity.mockResolvedValue(rawLabelRow());
    stub.todosWithLabel.mockResolvedValue([
      { id: "t1", labelIds: ["other"] },
      { id: "t2", labelIds: [] },
    ]);

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/labels/label-1"), env);

    expect(res.status).toBe(204);
    expect(stub.push).toHaveBeenCalledTimes(1);

    const entries = pushedEntries(stub);
    expect(entries).toHaveLength(3);
    expect(entries[0].patch).toMatchObject({ labelIds: ["other"] });
    expect(entries[1].patch).toMatchObject({ labelIds: [] });
    expect(entries[2]).toMatchObject({ kind: "label", entityId: "label-1" });
  });

  it("DELETE 409s rather than splitting a batch too large to write atomically", async () => {
    stub.getEntity.mockResolvedValue(rawLabelRow());
    stub.todosWithLabel.mockResolvedValue(
      Array.from({ length: 451 }, (_, i) => ({ id: `t${i}`, labelIds: [] })),
    );

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/labels/label-1"), env);

    expect(res.status).toBe(409);
    expect(stub.push).not.toHaveBeenCalled();
  });
});

describe("tabs CRUD", () => {
  it("POST 201s and never accepts isDefault from the caller", async () => {
    stub.getEntity.mockResolvedValue(rawTabRow({ isDefault: false }));

    await handleV1Request(
      v1Request("POST", "/api/v1/tabs", { name: "Work", isDefault: true }),
      env,
    );

    expect(pushedEntries(stub)[0].patch).toMatchObject({ name: "Work", isDefault: false });
  });

  /** REGRESSION, the tab twin of the list `isBacklog` case. */
  it("REGRESSION: a rename does not reset isDefault", async () => {
    stub.getEntity.mockResolvedValue(rawTabRow());

    await handleV1Request(v1Request("PATCH", "/api/v1/tabs/tab-1", { name: "Renamed" }), env);

    const patch = pushedEntries(stub)[0].patch as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(["name", "updatedAt"]);
    expect(patch).not.toHaveProperty("isDefault");
  });

  it("DELETE rehomes its lists to the default tab, in ONE push", async () => {
    stub.getEntity.mockResolvedValue(rawTabRow({ id: "tab-9", isDefault: false }));
    stub.listIdsInTab.mockResolvedValue(["l1", "l2"]);
    stub.defaultTabId.mockResolvedValue("tab-1");

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/tabs/tab-9"), env);

    expect(res.status).toBe(204);
    expect(stub.push).toHaveBeenCalledTimes(1);

    const entries = pushedEntries(stub);
    expect(entries).toHaveLength(3);
    expect(entries.slice(0, 2).map((e) => e.patch)).toEqual([
      expect.objectContaining({ tabId: "tab-1" }),
      expect.objectContaining({ tabId: "tab-1" }),
    ]);
    expect(entries[2].kind).toBe("tab");
  });

  /** The default tab is where a deleted tab's lists go — removing it would
   * strand the next tab delete. */
  it("DELETE 409s on the default tab, without pushing", async () => {
    stub.getEntity.mockResolvedValue(rawTabRow({ isDefault: true }));

    const res = await handleV1Request(v1Request("DELETE", "/api/v1/tabs/tab-1"), env);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "default-tab-not-deletable" });
    expect(stub.push).not.toHaveBeenCalled();
  });
});

describe("label and tab scope gating", () => {
  it.each([
    ["GET", "/api/v1/labels/label-1", "read"],
    ["POST", "/api/v1/labels", "write"],
    ["PATCH", "/api/v1/labels/label-1", "write"],
    ["DELETE", "/api/v1/labels/label-1", "write"],
    ["GET", "/api/v1/tabs/tab-1", "read"],
    ["POST", "/api/v1/tabs", "write"],
    ["PATCH", "/api/v1/tabs/tab-1", "write"],
    ["DELETE", "/api/v1/tabs/tab-9", "write"],
  ])("%s %s demands %s", async (method, path, scope) => {
    stub.getEntity.mockResolvedValue(
      path.includes("label") ? rawLabelRow() : rawTabRow({ id: "tab-9", isDefault: false }),
    );

    await handleV1Request(
      v1Request(method, path, method === "GET" || method === "DELETE" ? undefined : { name: "x" }),
      env,
    );

    expect(authorize.mock.calls.map((c) => c[2])).toEqual([scope]);
  });
});
