import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Stand-ins for the server half of smart sorting (EI-367), which the :3000
 * suite does not run: a list to propose, a proposal on a to-do, and
 * (optionally) the setting that turns proposals on.
 *
 * Both go straight into IndexedDB — the same place a synced server write
 * lands — and the page reloads, because Dexie only notices its own writes.
 * The list record is Backlog's own row with a new id and name, so it carries
 * every field the schema needs without this file restating them.
 */
export async function addListAndPropose(
  page: Page,
  listName: string,
  todoTitles: string[],
  { smartSortEnabled = false } = {},
): Promise<string> {
  const listId = await page.evaluate(
    async ({ listName, todoTitles, smartSortEnabled }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("faite");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const all = (store: string) =>
        new Promise<Record<string, unknown>[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

      const [lists, tabs, todos] = await Promise.all([all("lists"), all("tabs"), all("todos")]);
      const backlog = lists.find((list) => list.isBacklog)!;
      const list = {
        ...backlog,
        id: crypto.randomUUID(),
        name: listName,
        isBacklog: false,
        tabId: tabs[0].id,
        position: `${backlog.position}V`,
      };

      const settings = smartSortEnabled ? await all("settings") : [];
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["lists", "todos", "settings"], "readwrite");
        tx.objectStore("lists").put(list);
        for (const todo of todos.filter((t) => todoTitles.includes(t.title as string))) {
          tx.objectStore("todos").put({ ...todo, suggestedListId: list.id });
        }
        // The Settings switch needs a saved key, which the :3000 suite has no
        // Worker to hold — so the setting is written where sync would put it.
        for (const row of settings) tx.objectStore("settings").put({ ...row, smartSortEnabled: true });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return list.id as string;
    },
    { listName, todoTitles, smartSortEnabled },
  );
  await page.reload();
  await expect(page.getByRole("region", { name: "Overflow" })).toBeVisible({ timeout: 15_000 });
  return listId;
}
