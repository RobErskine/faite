import type { OutboxEntry } from "@/lib/schema";
import type { ApplyPlan } from "./apply-plan";
import { planDrain } from "./drain";
import { SyncAuthError, type SyncTransport } from "./transport";
import { DEFAULT_PULL_LIMIT, MAX_PUSH_ENTRIES, SYNC_PROTOCOL_VERSION } from "./wire";
import type { PullResponse, PushRequest, PushResponse, WireChange } from "./wire";

/**
 * The sync engine: drains the outbox, pushes, pulls `since=version`, applies.
 * Split into three layers so the parts worth testing don't need Dexie, a
 * timer, or a DOM:
 *
 *  - `runSyncCycle` — one push+pull cycle against injected `SyncTransport` +
 *    `SyncStore`. Pure orchestration, no globals.
 *  - `createSyncRunner` — coalesces concurrent/rapid `runSync()` calls into
 *    at most one in-flight cycle plus one queued follow-up, so N triggers
 *    firing while a cycle is running produce at most 2 round trips, not N+1.
 *  - `createSyncEngine` — wires the runner to real triggers (focus, online,
 *    a visible-only jittered interval, Web Locks for cross-tab efficiency).
 *    This layer is deliberately NOT unit tested — it's DOM/timer glue with
 *    no decisions left to get wrong once the layers below it are right;
 *    covered by the two-browser smoke test instead.
 */

export interface SyncStore {
  getPendingOutbox(): Promise<OutboxEntry[]>;
  deleteOutboxEntries(ids: string[]): Promise<void>;
  applyPulledChanges(changes: WireChange[]): Promise<ApplyPlan>;
  /** 0 if never synced — pulls everything. */
  getCursor(): number;
  /** Call only after `applyPulledChanges` for that page has resolved. */
  setCursor(cursor: number): void;
  getNodeId(): string;
}

export type SyncOutcome =
  | { status: "ok"; pushed: number; pulled: number }
  | { status: "unauthenticated" }
  | { status: "error"; error: unknown };

/**
 * One push+pull cycle. Push-first: an entry acked here is deleted from the
 * outbox before the pull loop starts, so a slow pull loop can't leave a
 * just-pushed edit looking unsynced. `store.setCursor` is called only after
 * `applyPulledChanges` for that same page has resolved — the other order
 * risks losing whatever an interrupted apply missed, where this order only
 * risks a harmless re-pull.
 *
 * The push half is chunked at `MAX_PUSH_ENTRIES` (`routes.ts` enforces the
 * same limit server-side) and isolated from the pull half: a failing push
 * — a >500-entry outbox, a transient 5xx, a poison entry — records the error
 * and still runs the pull loop, rather than throwing before the pull ever
 * starts. Sync is two independent directions; a wedged upload must never
 * also wedge download. `SyncAuthError` is the one exception — it propagates
 * immediately without attempting the pull, since an unauthenticated session
 * can't pull either, and retrying either half is pointless until sign-in.
 */
export async function runSyncCycle(transport: SyncTransport, store: SyncStore): Promise<SyncOutcome> {
  const pending = await store.getPendingOutbox();
  const { batch, drop } = planDrain(pending, store.getNodeId());
  if (drop.length > 0) await store.deleteOutboxEntries(drop.map((entry) => entry.id));

  let pushed = 0;
  let pushError: unknown = null;

  for (let offset = 0; offset < batch.length; offset += MAX_PUSH_ENTRIES) {
    const chunk = batch.slice(offset, offset + MAX_PUSH_ENTRIES);
    const request: PushRequest = { protocol: SYNC_PROTOCOL_VERSION, entries: chunk };
    try {
      const result: PushResponse = await transport.push(request);
      // "Processed", not "applied" — a rejected entry is also permanently
      // deleted (retrying it can never help; see RejectReason), an acked
      // one because the server has it whether it won or lost the LWW
      // comparison.
      const toDelete = [...result.acked, ...result.rejected.map((r) => r.id)];
      if (toDelete.length > 0) await store.deleteOutboxEntries(toDelete);
      pushed += result.acked.length;
    } catch (error) {
      if (error instanceof SyncAuthError) throw error;
      // Stop pushing further chunks (a systemic failure blasting the rest
      // is more likely to pile up errors than succeed), but still pull —
      // that's the whole point of isolating this from the pull loop below.
      pushError = error;
      break;
    }
  }

  let pulled = 0;
  let cursor = store.getCursor();
  let hasMore = true;
  while (hasMore) {
    const page: PullResponse = await transport.pull(cursor, DEFAULT_PULL_LIMIT);
    if (page.changes.length > 0) {
      const plan = await store.applyPulledChanges(page.changes);
      pulled += plan.writes.length;
    }
    cursor = page.cursor;
    store.setCursor(cursor);
    hasMore = page.hasMore;
  }

  if (pushError) return { status: "error", error: pushError };
  return { status: "ok", pushed, pulled };
}

async function runOnce(transport: SyncTransport, store: SyncStore): Promise<SyncOutcome> {
  try {
    return await runSyncCycle(transport, store);
  } catch (error) {
    if (error instanceof SyncAuthError) return { status: "unauthenticated" };
    // Every prior failure here was silent — `trigger()` calls `runSync()`
    // with `void`, and the whole cycle could 400 every 30s for a week with
    // nothing in the console. One line is the difference between "caught in
    // five minutes" and "caught by a screenshot a week later".
    console.error("[faite] sync cycle failed", error);
    return { status: "error", error };
  }
}

export interface SyncRunner {
  runSync(): Promise<SyncOutcome>;
}

/**
 * Coalesces overlapping calls. A call that arrives while one is already
 * in-flight doesn't start a second round trip — it marks a follow-up and
 * shares the in-flight promise. This is an efficiency measure, not a
 * correctness one: `runSyncCycle` is idempotent (the merge is per-field LWW,
 * acks delete by explicit id, a page's apply is one Dexie transaction), so
 * two genuinely concurrent cycles would still converge — this only avoids
 * paying for a burst of triggers (focus + online + interval firing at once)
 * with a burst of network calls.
 */
export function createSyncRunner(transport: SyncTransport, store: SyncStore): SyncRunner {
  let inFlight: Promise<SyncOutcome> | null = null;
  let rerunRequested = false;

  function runSync(): Promise<SyncOutcome> {
    if (inFlight) {
      rerunRequested = true;
      return inFlight;
    }

    const cycle = (async () => {
      let result = await runOnce(transport, store);
      while (rerunRequested) {
        rerunRequested = false;
        result = await runOnce(transport, store);
      }
      return result;
    })();

    inFlight = cycle.finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { runSync };
}

export interface SyncEngineOptions {
  /** `getBoundOwnerId() === session.user.id` — NOT "has a session". A
   * session alone is true while `SessionProvider`'s "switch accounts?"
   * dialog is still open; syncing then would push one account's board into
   * another's Durable Object. */
  isActive(): boolean;
  intervalMs?: number;
  debounceMs?: number;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_DEBOUNCE_MS = 2_000;
const JITTER_RATIO = 0.2;

function jitteredInterval(baseMs: number): number {
  const jitter = baseMs * JITTER_RATIO;
  return baseMs - jitter + Math.random() * (2 * jitter);
}

function hasWebLocks(): boolean {
  return typeof navigator !== "undefined" && "locks" in navigator;
}

export interface SyncEngine extends SyncRunner {
  start(): void;
  stop(): void;
  /** Debounced trigger for a local write — see `sync-provider.tsx`'s
   * `useLiveQuery(() => outbox.count())`. */
  notifyLocalChange(): void;
}

export function createSyncEngine(
  transport: SyncTransport,
  store: SyncStore,
  options: SyncEngineOptions,
): SyncEngine {
  const runner = createSyncRunner(transport, store);
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let debounceId: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  function trigger(): void {
    if (!options.isActive()) return;
    if (hasWebLocks()) {
      // `ifAvailable` — a lock held by another tab means that tab is already
      // syncing, so this tab just skips this tick rather than queuing.
      void navigator.locks.request("faite:sync", { ifAvailable: true }, (lock) => {
        if (!lock) return;
        return runner.runSync();
      });
    } else {
      void runner.runSync();
    }
  }

  function clearInterval_(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function armInterval(): void {
    clearInterval_();
    intervalId = setInterval(trigger, jitteredInterval(intervalMs));
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === "visible") {
      trigger();
      armInterval();
    } else {
      clearInterval_();
    }
  }

  function start(): void {
    if (started || typeof window === "undefined") return;
    started = true;

    window.addEventListener("focus", trigger);
    window.addEventListener("online", trigger);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    trigger();
    if (document.visibilityState === "visible") armInterval();
  }

  function stop(): void {
    if (!started) return;
    started = false;

    window.removeEventListener("focus", trigger);
    window.removeEventListener("online", trigger);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    clearInterval_();
    if (debounceId !== null) {
      clearTimeout(debounceId);
      debounceId = null;
    }
  }

  function notifyLocalChange(): void {
    if (debounceId !== null) clearTimeout(debounceId);
    debounceId = setTimeout(() => {
      debounceId = null;
      trigger();
    }, debounceMs);
  }

  return { runSync: runner.runSync, start, stop, notifyLocalChange };
}
