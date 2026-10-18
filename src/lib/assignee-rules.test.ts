import { describe, expect, it } from "vitest";
import { doneProgress, hasBlockedAccess, validateAgentSpec } from "./assignee-rules";

const agent = { kind: "agent" as const };
const person = { kind: "person" as const };
const criterion = { id: "c1", text: "Tests pass", done: false };

describe("validateAgentSpec", () => {
  it("asks nothing of a to-do assigned to me", () => {
    expect(validateAgentSpec({ doneCriteria: [], access: null }, null)).toEqual([]);
    expect(validateAgentSpec({ doneCriteria: [], access: null }, undefined)).toEqual([]);
  });

  it("asks nothing of a person", () => {
    expect(validateAgentSpec({ doneCriteria: [], access: null }, person)).toEqual([]);
  });

  it("requires a criterion and a declared access list for an agent", () => {
    expect(validateAgentSpec({ doneCriteria: [], access: null }, agent)).toEqual([
      "missing-done",
      "missing-access",
    ]);
  });

  it("treats access: [] as declared", () => {
    expect(validateAgentSpec({ doneCriteria: [criterion], access: [] }, agent)).toEqual([]);
  });

  it("flags only the missing half", () => {
    expect(validateAgentSpec({ doneCriteria: [criterion], access: null }, agent)).toEqual([
      "missing-access",
    ]);
    expect(validateAgentSpec({ doneCriteria: [], access: [] }, agent)).toEqual(["missing-done"]);
  });
});

describe("card chip helpers", () => {
  it("counts finished criteria", () => {
    expect(
      doneProgress({ doneCriteria: [criterion, { ...criterion, id: "c2", done: true }] }),
    ).toEqual({ done: 1, total: 2 });
  });

  it("flags only blocked and needs_setup access", () => {
    expect(hasBlockedAccess({ access: null })).toBe(false);
    expect(hasBlockedAccess({ access: [{ name: "Repo", status: "granted" }] })).toBe(false);
    expect(hasBlockedAccess({ access: [{ name: "Repo", status: "blocked" }] })).toBe(true);
    expect(hasBlockedAccess({ access: [{ name: "Repo", status: "needs_setup" }] })).toBe(true);
  });
});

describe("rows written before EI-402", () => {
  it("reads missing fields defensively", () => {
    expect(validateAgentSpec({}, agent)).toEqual(["missing-done", "missing-access"]);
    expect(doneProgress({})).toEqual({ done: 0, total: 0 });
    expect(hasBlockedAccess({})).toBe(false);
  });
});
