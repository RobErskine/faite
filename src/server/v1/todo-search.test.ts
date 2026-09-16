import { describe, expect, it } from "vitest";
import { todoSchema, type Todo } from "@/lib/schema";
import { queryWords, rankTodoMatches, tokenize } from "./todo-search";

let n = 0;
function todo(title: string, extra: Partial<Todo> = {}): Todo {
  n += 1;
  return todoSchema.parse({
    id: `todo-${n}`,
    ownerId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    title,
    position: `a${n}`,
    ...extra,
  });
}

const titles = (todos: Todo[]) => todos.map((t) => t.title);

describe("tokenize / queryWords", () => {
  it("lower-cases, strips accents and punctuation", () => {
    expect(tokenize("Café: pick-up @ 5pm!")).toEqual(["cafe", "pick", "up", "5pm"]);
  });

  it("drops stop words and duplicates across terms", () => {
    expect(queryWords(["the dentist thing", "Dentist"])).toEqual(["dentist"]);
    expect(queryWords("the thing")).toEqual([]);
  });
});

describe("rankTodoMatches", () => {
  it("matches any word, not the whole phrase", () => {
    const todos = [todo("Dentist appointment"), todo("Buy milk")];
    expect(titles(rankTodoMatches(todos, "call about the dentist thing"))).toEqual(["Dentist appointment"]);
  });

  it("matches any of several terms — the client's synonyms", () => {
    const todos = [todo("Clean the sofa"), todo("Move the loveseat"), todo("Wash car")];
    expect(titles(rankTodoMatches(todos, ["couch", "sofa", "loveseat"])).sort()).toEqual([
      "Clean the sofa",
      "Move the loveseat",
    ]);
  });

  it("tolerates a prefix and a one-letter slip in longer words", () => {
    const todos = [todo("Vacuuming upstairs"), todo("Dentist appointment")];
    expect(titles(rankTodoMatches(todos, "vacuum"))).toEqual(["Vacuuming upstairs"]);
    expect(titles(rankTodoMatches(todos, "dentst"))).toEqual(["Dentist appointment"]);
    expect(titles(rankTodoMatches(todos, "dnetist"))).toEqual(["Dentist appointment"]);
  });

  it("gives short words no typo tolerance", () => {
    expect(rankTodoMatches([todo("Fix the car")], "cat")).toEqual([]);
  });

  it("ranks exact over prefix over typo, and title over description", () => {
    const todos = [
      todo("Laundry", { description: "fold the towel" }),
      todo("Towels rack"),
      todo("Towel"),
      todo("Towle hooks"),
    ];
    expect(titles(rankTodoMatches(todos, "towel"))).toEqual([
      "Towel",
      "Towels rack",
      "Towle hooks",
      "Laundry",
    ]);
  });

  it("more matched words rank higher", () => {
    const todos = [todo("Call mom"), todo("Call dentist about crown")];
    expect(titles(rankTodoMatches(todos, "call dentist"))[0]).toBe("Call dentist about crown");
  });

  it("breaks ties: open before done, then most recently updated", () => {
    const todos = [
      todo("Pay rent", { status: "done", updatedAt: "2026-09-10T00:00:00.000Z" }),
      todo("Pay rent", { updatedAt: "2026-09-01T00:00:00.000Z" }),
      todo("Pay rent", { updatedAt: "2026-09-05T00:00:00.000Z" }),
    ];
    const ranked = rankTodoMatches(todos, "rent");
    expect(ranked.map((t) => [t.status, t.updatedAt.slice(0, 10)])).toEqual([
      ["open", "2026-09-05"],
      ["open", "2026-09-01"],
      ["done", "2026-09-10"],
    ]);
  });

  it("matches nothing for an empty or stop-word-only query", () => {
    expect(rankTodoMatches([todo("The thing")], "the thing")).toEqual([]);
    expect(rankTodoMatches([todo("Anything")], [])).toEqual([]);
  });
});
