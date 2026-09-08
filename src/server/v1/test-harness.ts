import { vi } from "vitest";
import type { PushEntry, PushResponse } from "@/lib/sync/wire";

/**
 * Shared fakes for `/api/v1` route tests (A20, EI-304).
 *
 * **Not a `.test.ts`** — vitest's `include` glob would collect it as a suite
 * with no tests and fail. A14 through A17 import from here rather than each
 * rebuilding a fake Durable Object.
 *
 * The pattern is `src/server/contact/routes.test.ts`'s: call the REAL handler
 * with a fake `CloudflareEnv` of `vi.fn()` bindings, cast through `unknown`.
 * Deliberately not `@cloudflare/vitest-pool-workers` — these tests are about
 * dispatch, status codes and scope gating, none of which need a real Workers
 * runtime, and `push.ts`'s pipeline is already covered against the real
 * implementation in `service/*.test.ts`.
 *
 * The auth seam is mocked by the TEST FILE, not here: `vi.mock` is hoisted
 * above imports, so it cannot be re-exported from a helper module. See
 * `routes.test.ts` for the two-line incantation to copy.
 */

/** Every DO RPC `/api/v1` reaches, as a spy. Add to this as routes grow. */
export interface FakeStub {
  listEntities: ReturnType<typeof vi.fn>;
  getTodo: ReturnType<typeof vi.fn>;
  getEntity: ReturnType<typeof vi.fn>;
  nextTodoPosition: ReturnType<typeof vi.fn>;
  nextPosition: ReturnType<typeof vi.fn>;
  defaultReminderTimeForList: ReturnType<typeof vi.fn>;
  nextServerHlc: ReturnType<typeof vi.fn>;
  childTodoIds: ReturnType<typeof vi.fn>;
  todoIdsInList: ReturnType<typeof vi.fn>;
  backlogListId: ReturnType<typeof vi.fn>;
  listIdsInTab: ReturnType<typeof vi.fn>;
  defaultTabId: ReturnType<typeof vi.fn>;
  todosWithLabel: ReturnType<typeof vi.fn>;
  attachmentIdsForTodo: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
}

export function okPushResponse(): PushResponse {
  return { acked: [], rejected: [], highestVersion: 1, conflicts: [] };
}

/**
 * A Durable Object stub that answers every read with an empty/benign default.
 * Override per test with `stub.getTodo.mockResolvedValue(...)`.
 *
 * `nextServerHlc` hands back a fresh, ordered stamp each call — `durableHlcQueue`
 * pre-fetches N of them and a repeated value would mask a real collision.
 */
export function makeStub(overrides: Partial<FakeStub> = {}): FakeStub {
  let hlcCounter = 0;

  return {
    listEntities: vi.fn().mockResolvedValue([]),
    getTodo: vi.fn().mockResolvedValue(null),
    getEntity: vi.fn().mockResolvedValue(null),
    nextTodoPosition: vi.fn().mockResolvedValue("a1"),
    nextPosition: vi.fn().mockResolvedValue("a1"),
    defaultReminderTimeForList: vi.fn().mockResolvedValue(null),
    nextServerHlc: vi.fn().mockImplementation(async () => {
      hlcCounter += 1;
      return `000000001388:${String(hlcCounter).padStart(4, "0")}:server`;
    }),
    childTodoIds: vi.fn().mockResolvedValue([]),
    todoIdsInList: vi.fn().mockResolvedValue([]),
    backlogListId: vi.fn().mockResolvedValue("backlog-1"),
    listIdsInTab: vi.fn().mockResolvedValue([]),
    defaultTabId: vi.fn().mockResolvedValue("tab-1"),
    todosWithLabel: vi.fn().mockResolvedValue([]),
    attachmentIdsForTodo: vi.fn().mockResolvedValue([]),
    push: vi.fn().mockResolvedValue(okPushResponse()),
    ...overrides,
  };
}

export function makeEnv(stub: FakeStub): CloudflareEnv {
  return {
    USER_DO: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => stub),
    },
    AUTH_DB: {},
  } as unknown as CloudflareEnv;
}

export function v1Request(method: string, path: string, body?: unknown): Request {
  return new Request(`https://myfaite.app${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      // Present so `extractBearerCredential` sees a credential; `authorizeScope`
      // itself is mocked, so the value is never verified.
      Authorization: "Bearer faite_test",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * A raw DO row as `listEntities`/`getTodo` really return it — camelCase, and
 * **carrying `version`**, the SQLite-only column the entity schemas never
 * declare.
 *
 * Including it is the point: `routes.ts`'s header claims `schema.parse()`
 * strips `version` by virtue of not declaring it, and every response asserts
 * that claim rather than assuming it.
 */
export function rawTodoRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 42,
    id: "todo-1",
    ownerId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    title: "Buy milk",
    description: null,
    status: "open",
    priority: null,
    scheduledDate: null,
    scheduledAt: null,
    deadline: null,
    listId: null,
    projectId: null,
    labelIds: [],
    location: null,
    placeId: null,
    parentId: null,
    position: "a0",
    recurrenceRule: null,
    recurrenceParentId: null,
    completedAt: null,
    reminderTime: null,
    source: null,
    ...overrides,
  };
}

/** The `PushEntry[]` handed to the single expected `push()` call. */
export function pushedEntries(stub: FakeStub, call = 0): PushEntry[] {
  return stub.push.mock.calls[call][1].entries as PushEntry[];
}

/** A raw `lists` row, `version` included — same rationale as `rawTodoRow`. */
export function rawListRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 7,
    id: "list-1",
    ownerId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    name: "Errands",
    isBacklog: false,
    archivedAt: null,
    archivedWithTabId: null,
    position: "a0",
    tabId: "tab-1",
    defaultReminderPresetId: null,
    description: null,
    color: null,
    emoji: null,
    iconUrl: null,
    ...overrides,
  };
}

/** A raw `tabs` row. `isDefault` matters — `defaultTabIdFor` finds the tab a
 * new list lands in by scanning for it. */
export function rawTabRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    id: "tab-1",
    ownerId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    name: "Personal",
    description: null,
    isDefault: true,
    archivedAt: null,
    position: "a0",
    color: null,
    emoji: null,
    iconUrl: null,
    ...overrides,
  };
}

/** A raw `labels` row, `version` included. */
export function rawLabelRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 5,
    id: "label-1",
    ownerId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    name: "Urgent",
    position: "a0",
    color: null,
    emoji: null,
    iconUrl: null,
    ...overrides,
  };
}
