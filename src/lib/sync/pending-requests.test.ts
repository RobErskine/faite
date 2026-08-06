import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPendingRequests,
  SyncSocketClosedError,
  SyncTimeoutError,
} from "./pending-requests";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createPendingRequests", () => {
  it("resolves a registered request by id", async () => {
    const pending = createPendingRequests<string>();
    const settled = pending.register("a", 1000);
    expect(pending.resolve("a", "hello")).toBe(true);
    await expect(settled).resolves.toBe("hello");
    expect(pending.size()).toBe(0);
  });

  it("resolves out of order — nothing assumes one request at a time", async () => {
    // `runSyncCycle` doesn't issue concurrent calls today (engine.ts
    // coalesces), but nothing this deep in the stack should depend on that
    // invariant holding forever.
    const pending = createPendingRequests<string>();
    const first = pending.register("first", 1000);
    const second = pending.register("second", 1000);

    pending.resolve("second", "2");
    pending.resolve("first", "1");

    await expect(first).resolves.toBe("1");
    await expect(second).resolves.toBe("2");
  });

  it("DROPS an unknown id rather than treating it as an error", async () => {
    // A late reply arriving after its own timeout must not disturb an
    // unrelated in-flight request.
    const pending = createPendingRequests<string>();
    const settled = pending.register("live", 1000);
    expect(pending.resolve("ghost", "stale")).toBe(false);
    expect(pending.size()).toBe(1);
    pending.resolve("live", "ok");
    await expect(settled).resolves.toBe("ok");
  });

  it("times out a request that never gets a reply", async () => {
    const pending = createPendingRequests<string>();
    const settled = pending.register("a", 5000);
    const assertion = expect(settled).rejects.toBeInstanceOf(SyncTimeoutError);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
    expect(pending.size()).toBe(0);
  });

  it("REGRESSION: a timeout notifies the owner so it can tear the channel down", async () => {
    // The whole reason this callback exists. A zombie socket keeps
    // readyState === OPEN long after a laptop sleeps, so if a timeout were
    // just "this call failed", every later push and pull would pay the full
    // timeout too -- inside runSyncCycle's `while (hasMore)` loop, against a
    // 30s interval. That is a wedged engine, not a fallback.
    const timedOut: string[] = [];
    const pending = createPendingRequests<string>((id) => timedOut.push(id));
    const settled = pending.register("a", 1000);
    const assertion = expect(settled).rejects.toBeInstanceOf(SyncTimeoutError);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(timedOut).toEqual(["a"]);
  });

  it("does not fire the timeout callback for a request that resolved in time", async () => {
    const timedOut: string[] = [];
    const pending = createPendingRequests<string>((id) => timedOut.push(id));
    const settled = pending.register("a", 1000);
    pending.resolve("a", "quick");
    await settled;
    await vi.advanceTimersByTimeAsync(5000);
    expect(timedOut).toEqual([]);
  });

  it("rejects everything in flight when the channel closes", async () => {
    const pending = createPendingRequests<string>();
    const a = pending.register("a", 10_000);
    const b = pending.register("b", 10_000);
    const assertions = Promise.all([
      expect(a).rejects.toBeInstanceOf(SyncSocketClosedError),
      expect(b).rejects.toBeInstanceOf(SyncSocketClosedError),
    ]);
    pending.rejectAll(new SyncSocketClosedError());
    await assertions;
    expect(pending.size()).toBe(0);
  });

  it("clears timers on rejectAll, so a closed channel cannot fire timeouts later", async () => {
    const timedOut: string[] = [];
    const pending = createPendingRequests<string>((id) => timedOut.push(id));
    const settled = pending.register("a", 1000);
    const assertion = expect(settled).rejects.toBeInstanceOf(SyncSocketClosedError);
    pending.rejectAll(new SyncSocketClosedError());
    await assertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(timedOut).toEqual([]);
  });

  it("REGRESSION: a reject handler that immediately re-registers is not torn down with the batch", async () => {
    // `rejectAll` snapshots and clears BEFORE rejecting for this reason: a
    // rejection can synchronously start a reconnect that enqueues a new
    // request, and that new request must survive.
    const pending = createPendingRequests<string>();
    let revived: Promise<string> | null = null;
    const first = pending.register("a", 10_000).catch(() => {
      revived = pending.register("b", 10_000);
      return "rejected";
    });

    pending.rejectAll(new SyncSocketClosedError());
    await first;

    expect(pending.size()).toBe(1);
    expect(pending.resolve("b", "survived")).toBe(true);
    await expect(revived!).resolves.toBe("survived");
  });

  it("is idempotent — a second rejectAll is a no-op", () => {
    const pending = createPendingRequests<string>();
    void pending.register("a", 1000).catch(() => {});
    pending.rejectAll(new SyncSocketClosedError());
    expect(() => pending.rejectAll(new SyncSocketClosedError())).not.toThrow();
    expect(pending.size()).toBe(0);
  });
});
