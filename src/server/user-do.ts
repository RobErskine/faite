import { DurableObject } from "cloudflare:workers";

/**
 * Per-user Durable Object. Authoritative store for one user's todos/lists/labels
 * and the coordinator for sync (plan P3).
 *
 * Chosen over a single shared D1 because it gives us, for free:
 *   - a monotonic per-user changelog (drives `since=version` pulls)
 *   - single-writer serialization (no cross-user write contention)
 *   - WebSocket hibernation for live push at P4
 *
 * D1 holds only auth/global tables, which need a conventional SQL adapter.
 *
 * P0 status: skeleton only. Storage schema and the sync protocol land in P3.
 * It exists now so the custom worker entry, DO binding, and the `v1` SQLite
 * migration are in place before sync work starts.
 */
export class UserDurableObject extends DurableObject {
  async fetch(): Promise<Response> {
    return Response.json(
      { ok: true, phase: "P0", note: "UserDurableObject skeleton; sync lands in P3" },
      { status: 200 },
    );
  }
}
