import { describe, expect, it } from "vitest";
import { DESKTOP_KEY_NAME } from "../auth-scopes";
import { desktopKeyName, readDeviceName } from "./routes";

function bodyRequest(body: unknown): Request {
  return new Request("https://myfaite.app/api/desktop/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("readDeviceName (EI-261)", () => {
  it("reads a well-formed device name", async () => {
    expect(await readDeviceName(bodyRequest({ deviceName: "Robs-MacBook-Pro.local" }))).toBe(
      "Robs-MacBook-Pro.local",
    );
  });

  it("trims surrounding whitespace", async () => {
    expect(await readDeviceName(bodyRequest({ deviceName: "  MacBook  " }))).toBe("MacBook");
  });

  it("returns null for a missing deviceName field", async () => {
    expect(await readDeviceName(bodyRequest({}))).toBeNull();
  });

  it("returns null for a non-string deviceName rather than throwing", async () => {
    expect(await readDeviceName(bodyRequest({ deviceName: 12345 }))).toBeNull();
  });

  it("returns null for an empty or whitespace-only deviceName", async () => {
    expect(await readDeviceName(bodyRequest({ deviceName: "" }))).toBeNull();
    expect(await readDeviceName(bodyRequest({ deviceName: "   " }))).toBeNull();
  });

  it("returns null for a malformed body rather than throwing", async () => {
    const request = new Request("https://myfaite.app/api/desktop/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(await readDeviceName(request)).toBeNull();
  });

  it("truncates an unusually long device name instead of failing the whole handoff", async () => {
    const huge = "x".repeat(500);
    const result = await readDeviceName(bodyRequest({ deviceName: huge }));
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(64);
  });
});

describe("desktopKeyName (EI-261)", () => {
  it("appends the device name after the prefix", () => {
    expect(desktopKeyName("Robs-MacBook-Pro.local")).toBe(`${DESKTOP_KEY_NAME} — Robs-MacBook-Pro.local`);
  });

  it("falls back to the bare prefix when there is no device name", () => {
    expect(desktopKeyName(null)).toBe(DESKTOP_KEY_NAME);
  });
});
