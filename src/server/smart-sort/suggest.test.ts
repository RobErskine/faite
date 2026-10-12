import { describe, expect, it, vi } from "vitest";
import { JEV_ENDPOINT, JEV_MODEL } from "../duplicates/check";
import {
  buildSuggestRequest,
  type ListOption,
  MAX_LIST_OPTIONS,
  optionKeys,
  parseSuggestions,
  QUESTIONS_PER_REQUEST,
  SUGGEST_THRESHOLD,
  suggestLists,
} from "./suggest";

const list = (id: string, name: string, extra: Partial<ListOption> = {}): ListOption => ({
  id,
  name,
  tabName: null,
  description: null,
  ...extra,
});

const LISTS = [
  list("l-groceries", "Groceries", { tabName: "Home", description: "Food and household supplies." }),
  list("l-work", "Work inbox", { tabName: "Work" }),
];

/** A fake Jev that answers every question with `choice` at `confidence`. */
function fakeJev(choice: string, confidence: number) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
    const answers = Object.fromEntries(
      Object.keys(body.questions).map((id) => [id, { type: "choice", choice, confidence }]),
    );
    return Response.json({ answers });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("optionKeys", () => {
  it("names options after the list, unique, and never `none`", () => {
    const keys = optionKeys([
      list("a", "Groceries"),
      list("b", "groceries!"),
      list("c", "None"),
      list("d", "🎉"),
      list("e", "Café & Bar"),
    ]);
    expect([...keys]).toEqual([
      ["groceries", "a"],
      ["groceries_2", "b"],
      ["list_none", "c"],
      ["list", "d"],
      ["cafe_bar", "e"],
    ]);
  });
});

describe("buildSuggestRequest", () => {
  it("asks one Choice per to-do over every list plus `none`", () => {
    const keys = optionKeys(LISTS);
    const body = buildSuggestRequest(
      [{ title: "Buy oat milk", description: null }, { title: "Send the Q3 deck", description: "to Dana" }],
      LISTS,
      keys,
    );

    expect(body.model).toBe(JEV_MODEL);
    expect(body.state).toEqual({ todos: [{ title: "Buy oat milk" }, { title: "Send the Q3 deck", notes: "to Dana" }] });
    expect(Object.keys(body.questions)).toEqual(["q0", "q1"]);
    expect(body.questions.q1.type).toBe("choice");
    expect(body.questions.q1.instructions).toContain("`todos[1]`");
    expect(body.questions.q0.criteria).toEqual({
      groceries: 'The "Groceries" list, on the "Home" tab. Food and household supplies.',
      work_inbox: 'The "Work inbox" list, on the "Work" tab.',
      none: expect.any(String),
    });
  });
});

describe("parseSuggestions", () => {
  const keys = optionKeys(LISTS);

  it("maps a confident choice back to its list id", () => {
    const answers = { q0: { choice: "groceries", confidence: SUGGEST_THRESHOLD } };
    expect(parseSuggestions({ answers }, 1, keys)).toEqual(["l-groceries"]);
  });

  it("proposes nothing for `none`, low confidence, an unknown key, or a missing answer", () => {
    const answers = {
      q0: { choice: "none", confidence: 0.99 },
      q1: { choice: "groceries", confidence: SUGGEST_THRESHOLD - 0.01 },
      q2: { choice: "made_up", confidence: 0.99 },
    };
    expect(parseSuggestions({ answers }, 4, keys)).toEqual([null, null, null, null]);
  });
});

describe("suggestLists", () => {
  const todos = Array.from({ length: QUESTIONS_PER_REQUEST + 1 }, (_, i) => ({
    title: `Task ${i}`,
    description: null,
  }));

  it("chunks the to-dos and returns one answer per to-do, in order", async () => {
    const fetchImpl = fakeJev("work_inbox", 0.9);

    const result = await suggestLists("key", todos, LISTS, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(JEV_ENDPOINT);
    expect(result).toEqual(todos.map(() => "l-work"));
  });

  it("does not call Jev with no lists or too many", async () => {
    const fetchImpl = fakeJev("work_inbox", 0.9);
    const tooMany = Array.from({ length: MAX_LIST_OPTIONS + 1 }, (_, i) => list(`l${i}`, `List ${i}`));

    expect(await suggestLists("key", todos.slice(0, 1), [], fetchImpl)).toEqual([null]);
    expect(await suggestLists("key", todos.slice(0, 1), tooMany, fetchImpl)).toEqual([null]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when Jev fails, so the caller proposes nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(suggestLists("key", todos.slice(0, 1), LISTS, fetchImpl)).rejects.toThrow("429");
  });
});
