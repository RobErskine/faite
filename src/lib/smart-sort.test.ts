// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proposeListForNewTodo, resetListSuggestions } from "./smart-sort";
import { getDb, resetDbForTests } from "./store/db";
import { mutateSettings } from "./store/mutate";
import { LOCAL_OWNER_ID } from "./store/owner";
import { createList, createTodo, seedIfEmpty } from "./store/repositories";

/**
 * The board asks Jev the moment it creates a to-do (EI-373). These pin the
 * gates that keep it from spending the user's credit — or writing a proposal
 * — when it should not, and the one network shape it sends.
 */

let groceriesId: string;
const fetchMock = vi.fn();

function answer(status: number, suggestions: Record<string, string | null> = {}) {
  fetchMock.mockResolvedValueOnce(Response.json({ suggestions }, { status }));
}

beforeEach(async () => {
  localStorage.clear();
  await resetDbForTests();
  await seedIfEmpty();
  await mutateSettings(LOCAL_OWNER_ID, { smartSortEnabled: true });
  groceriesId = await createList("Groceries");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetListSuggestions();
});

const suggestedListOf = async (id: string) => (await getDb().todos.get(id))?.suggestedListId ?? null;

describe("proposeListForNewTodo", () => {
  it("sends the to-do's text and writes the proposal locally", async () => {
    const id = await createTodo({ title: "Buy oat milk" });
    answer(200, { [id]: groceriesId });

    await proposeListForNewTodo(id);

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ todos: [{ id, title: "Buy oat milk", description: null }] });
    expect(await suggestedListOf(id)).toBe(groceriesId);
  });

  it("does not ask when smart sorting is off, or for a to-do outside Backlog", async () => {
    const scheduled = await createTodo({ title: "Dentist", scheduledDate: "2026-10-14" });
    const filed = await createTodo({ title: "Eggs", listId: groceriesId });
    await proposeListForNewTodo(scheduled);
    await proposeListForNewTodo(filed);

    await mutateSettings(LOCAL_OWNER_ID, { smartSortEnabled: false });
    await proposeListForNewTodo(await createTodo({ title: "Buy oat milk" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not overwrite a to-do the user filed while Jev was answering", async () => {
    const id = await createTodo({ title: "Buy oat milk" });
    fetchMock.mockImplementationOnce(async () => {
      await getDb().todos.update(id, { listId: groceriesId });
      return Response.json({ suggestions: { [id]: groceriesId } });
    });

    await proposeListForNewTodo(id);

    expect(await suggestedListOf(id)).toBeNull();
  });

  it("stops asking for the session once the route says there is no key", async () => {
    answer(409);
    await proposeListForNewTodo(await createTodo({ title: "One" }));
    await proposeListForNewTodo(await createTodo({ title: "Two" }));
    expect(fetchMock).toHaveBeenCalledOnce();

    resetListSuggestions();
    answer(200);
    await proposeListForNewTodo(await createTodo({ title: "Three" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks again after a Jev failure", async () => {
    answer(502);
    await proposeListForNewTodo(await createTodo({ title: "One" }));
    answer(200);
    await proposeListForNewTodo(await createTodo({ title: "Two" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
