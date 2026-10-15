import { beforeEach, describe, expect, it, vi } from "vitest";

const plain = vi.fn();
const success = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(plain, { success }) }));

const { outcomeToast, toneForStatus } = await import("./outcome-toast");

beforeEach(() => {
  plain.mockClear();
  success.mockClear();
});

/**
 * EI-387: the status toast for Won't do wore the same green check as Done,
 * congratulating the user for letting something go.
 */
describe("toneForStatus", () => {
  it("gives Done the success check", () => {
    expect(toneForStatus("done")).toBe("success");
  });

  it("gives Won't do no check", () => {
    expect(toneForStatus("dropped")).toBe("neutral");
  });
});

describe("outcomeToast", () => {
  it("raises Done as a success toast, with sonner's own check", () => {
    outcomeToast(toneForStatus("done"), "Completed “Call dentist”", { duration: 6000 });
    expect(success).toHaveBeenCalledWith("Completed “Call dentist”", {
      duration: 6000,
      icon: undefined,
    });
    expect(plain).not.toHaveBeenCalled();
  });

  it("raises Won't do as a plain toast with no icon", () => {
    outcomeToast(toneForStatus("dropped"), "Won’t do “Call dentist”", { duration: 6000 });
    expect(plain).toHaveBeenCalledWith("Won’t do “Call dentist”", { duration: 6000, icon: null });
    expect(success).not.toHaveBeenCalled();
  });
});
