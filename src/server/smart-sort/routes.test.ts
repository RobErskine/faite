import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../auth", () => ({ createAuth: () => ({ api: { getSession } }) }));

import { handleSmartSortRequest, MAX_TODO_IDS } from "./routes";

const suggestListsFor = vi.fn();
const env = {
  USER_DO: { idFromName: (name: string) => name, get: () => ({ suggestListsFor }) },
} as unknown as CloudflareEnv;

function post(body: unknown, path = "/api/smart-sort/suggest"): Request {
  return new Request(`https://myfaite.app${path}`, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  suggestListsFor.mockReset().mockResolvedValue({ connected: true, suggestions: { a: "l-1", b: null } });
});

describe("POST /api/smart-sort/suggest", () => {
  it("returns the Durable Object's proposals, deduplicating ids", async () => {
    const res = await handleSmartSortRequest(post({ todoIds: ["a", "b", "a"] }), env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: { a: "l-1", b: null } });
    expect(suggestListsFor).toHaveBeenCalledWith(["a", "b"]);
  });

  it("is 401 without a session", async () => {
    getSession.mockResolvedValue(null);
    expect((await handleSmartSortRequest(post({ todoIds: ["a"] }), env)).status).toBe(401);
  });

  it("is 422 for a missing, empty, oversized or malformed id list", async () => {
    for (const body of [{}, { todoIds: [] }, { todoIds: [1] }, { todoIds: Array(MAX_TODO_IDS + 1).fill("a") }]) {
      expect((await handleSmartSortRequest(post(body), env)).status).toBe(422);
    }
    expect(suggestListsFor).not.toHaveBeenCalled();
  });

  it("is 409 with no key and 502 when Jev fails", async () => {
    suggestListsFor.mockResolvedValueOnce({ connected: false, suggestions: {} });
    expect((await handleSmartSortRequest(post({ todoIds: ["a"] }), env)).status).toBe(409);

    suggestListsFor.mockRejectedValueOnce(new Error("Jev responded 503"));
    expect((await handleSmartSortRequest(post({ todoIds: ["a"] }), env)).status).toBe(502);
  });

  it("is 405 for any other method and 404 for any other path", async () => {
    const get = new Request("https://myfaite.app/api/smart-sort/suggest");
    expect((await handleSmartSortRequest(get, env)).status).toBe(405);
    expect((await handleSmartSortRequest(post({}, "/api/smart-sort/other"), env)).status).toBe(404);
  });
});
