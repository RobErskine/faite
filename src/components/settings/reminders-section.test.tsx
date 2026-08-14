// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests, getDb } from "@/lib/store/db";
import { RemindersSection } from "./reminders-section";

beforeEach(async () => {
  await resetDbForTests();
});
afterEach(cleanup);

describe("RemindersSection — notification permission", () => {
  it("renders the permission prompt copy", () => {
    render(<RemindersSection />);
    expect(screen.getByText("Reminder notifications")).toBeTruthy();
  });
});

describe("RemindersSection — preset manager", () => {
  it("shows an empty state with no presets", () => {
    render(<RemindersSection />);
    expect(screen.getByText("No reminder presets yet.")).toBeTruthy();
  });

  it("adding a preset writes it to the store and clears the form", async () => {
    render(<RemindersSection />);

    fireEvent.change(screen.getByPlaceholderText("Name — Morning, Gym…"), {
      target: { value: "Gym" },
    });
    fireEvent.change(screen.getByLabelText("Preset time"), {
      target: { value: "06:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(async () => {
      const rows = await getDb().reminderPresets.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: "Gym", time: "06:30" });
    });

    expect(screen.getByPlaceholderText("Name — Morning, Gym…")).toHaveProperty("value", "");
  });

  it("deleting a preset removes it from the list", async () => {
    const { createReminderPreset } = await import("@/lib/store/repositories");
    await createReminderPreset("Morning", "08:00");

    render(<RemindersSection />);
    await screen.findByDisplayValue("Morning");

    fireEvent.click(screen.getByRole("button", { name: "Delete Morning" }));

    await waitFor(() => expect(screen.queryByDisplayValue("Morning")).toBeNull());
    // Soft delete — the row survives with deletedAt set, filtered out by
    // useReminderPresets()'s alive() rather than actually removed.
    const rows = await getDb().reminderPresets.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();
  });

  it("the Add button is disabled without both a name and a time", () => {
    render(<RemindersSection />);
    const addButton = screen.getByRole("button", { name: "Add" });
    expect(addButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByPlaceholderText("Name — Morning, Gym…"), {
      target: { value: "Gym" },
    });
    expect(addButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Preset time"), { target: { value: "06:30" } });
    expect(addButton).toHaveProperty("disabled", false);
  });
});

describe("RemindersSection — renaming a preset (PresetRow, commit-on-blur)", () => {
  it(
    "REGRESSION: does not write on every keystroke, and rejects an empty name on blur " +
      "rather than writing it or permanently locking the field (a fully-controlled field " +
      "bound straight to the store, with a write guard on empty, would snap back to the " +
      "old value on every keystroke that empties it — the field could never be cleared " +
      "and retyped)",
    async () => {
      const { createReminderPreset } = await import("@/lib/store/repositories");
      await createReminderPreset("Morning", "08:00");
      render(<RemindersSection />);
      const nameField = await screen.findByLabelText("Morning name");

      // Clear it entirely — no store write yet, this is local draft only.
      fireEvent.change(nameField, { target: { value: "" } });
      let rows = await getDb().reminderPresets.toArray();
      expect(rows[0].name).toBe("Morning"); // unchanged — still just a draft

      // Blur while empty — rejected, draft reverts, store still unchanged.
      fireEvent.blur(nameField);
      rows = await getDb().reminderPresets.toArray();
      expect(rows[0].name).toBe("Morning");
      expect(nameField).toHaveProperty("value", "Morning");

      // Now retype and blur with a real value — this DOES commit.
      fireEvent.change(nameField, { target: { value: "Gym" } });
      fireEvent.blur(nameField);
      await waitFor(async () => {
        const updated = await getDb().reminderPresets.toArray();
        expect(updated[0].name).toBe("Gym");
      });
    },
  );

  it("commits on Enter, not just blur", async () => {
    const { createReminderPreset } = await import("@/lib/store/repositories");
    await createReminderPreset("Morning", "08:00");
    render(<RemindersSection />);
    const nameField = await screen.findByLabelText("Morning name");

    fireEvent.change(nameField, { target: { value: "Wake up" } });
    fireEvent.keyDown(nameField, { key: "Enter" });

    await waitFor(async () => {
      const rows = await getDb().reminderPresets.toArray();
      expect(rows[0].name).toBe("Wake up");
    });
  });
});
