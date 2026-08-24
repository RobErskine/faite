import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbForTests } from "./db";

/**
 * The ordering contract between the two planes an attachment lives in.
 *
 * `lib/attachments.ts` is mocked because it is the network — the point of
 * these tests is what the LOCAL store does around a call that succeeds or
 * fails, not what the Worker does. The Worker's own gate is covered by
 * `src/server/attachments/validate.test.ts`.
 */

const uploadAttachment = vi.hoisted(() => vi.fn());
const deleteAttachmentBytes = vi.hoisted(() => vi.fn());

vi.mock("@/lib/attachments", () => ({
  uploadAttachment,
  deleteAttachmentBytes,
  AttachmentError: class AttachmentError extends Error {},
}));

const { createAttachment, deleteAttachment } = await import("./repositories");

const TODO_ID = "todo-1";

function uploadResult(id: string) {
  return {
    id,
    todoId: TODO_ID,
    filename: "report.pdf",
    mimeType: "application/pdf",
    byteSize: 1234,
    storageKey: `att/owner/${id}-abc`,
  };
}

beforeEach(async () => {
  await resetDbForTests();
  uploadAttachment.mockReset();
  deleteAttachmentBytes.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAttachment", () => {
  it("writes the row from the SERVER's values, not the File's", async () => {
    // The browser's `File` claims a different name and type on purpose: the
    // server sanitized the name and verified the type against the bytes, so
    // echoing the originals here would let the row disagree with storage.
    uploadAttachment.mockImplementation(async (_file, _todoId, id) => uploadResult(id));
    const file = { name: 'evil"name.pdf', type: "text/html", size: 9 } as unknown as File;

    const id = await createAttachment(file, TODO_ID);
    const row = await getDb().attachments.get(id);

    expect(row).toMatchObject({
      todoId: TODO_ID,
      filename: "report.pdf",
      mimeType: "application/pdf",
      byteSize: 1234,
      deletedAt: null,
    });
  });

  it("passes the row's own id to the upload, so key and row agree", async () => {
    uploadAttachment.mockImplementation(async (_file, _todoId, id) => uploadResult(id));
    const id = await createAttachment({ name: "a.pdf" } as File, TODO_ID);
    expect(uploadAttachment).toHaveBeenCalledWith(expect.anything(), TODO_ID, id);
  });

  it("enqueues the row for sync like any other entity", async () => {
    uploadAttachment.mockImplementation(async (_file, _todoId, id) => uploadResult(id));
    const id = await createAttachment({ name: "a.pdf" } as File, TODO_ID);

    const outbox = await getDb().outbox.toArray();
    const entry = outbox.find((e) => e.entityId === id);
    expect(entry?.kind).toBe("attachment");
    // A create pushes the whole row — `storageKey` included, or another
    // device could never fetch the bytes.
    expect(entry?.patch).toMatchObject({ storageKey: expect.stringContaining("att/") });
  });

  it("WRITES NOTHING when the upload fails — no row may outlive its bytes", async () => {
    uploadAttachment.mockRejectedValue(new Error("network"));

    await expect(createAttachment({ name: "a.pdf" } as File, TODO_ID)).rejects.toThrow();

    // The invariant. A row written before the bytes land would 404 forever on
    // every device, with nothing to repair it.
    expect(await getDb().attachments.count()).toBe(0);
    expect(await getDb().outbox.count()).toBe(0);
  });
});

describe("deleteAttachment", () => {
  it("tombstones the row and then deletes the bytes, in that order", async () => {
    uploadAttachment.mockImplementation(async (_file, _todoId, id) => uploadResult(id));
    const id = await createAttachment({ name: "a.pdf" } as File, TODO_ID);

    const order: string[] = [];
    deleteAttachmentBytes.mockImplementation(async () => {
      // Read the row from INSIDE the byte delete: the tombstone must already
      // be there, because it is the half that syncs and therefore the half
      // that must be durable first.
      const row = await getDb().attachments.get(id);
      order.push(row?.deletedAt ? "tombstoned-first" : "bytes-first");
    });

    await deleteAttachment(id);

    expect(order).toEqual(["tombstoned-first"]);
    expect(deleteAttachmentBytes).toHaveBeenCalledWith(id);
  });

  it("still tombstones when the byte delete fails — an orphan beats a broken row", async () => {
    uploadAttachment.mockImplementation(async (_file, _todoId, id) => uploadResult(id));
    const id = await createAttachment({ name: "a.pdf" } as File, TODO_ID);
    deleteAttachmentBytes.mockRejectedValue(new Error("R2 down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Must not throw: the user asked to remove the file, and the durable,
    // syncing half of that succeeded.
    await expect(deleteAttachment(id)).resolves.toBeUndefined();
    expect((await getDb().attachments.get(id))?.deletedAt).toBeTruthy();
  });
});
