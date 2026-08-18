import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "../auth-schema";

/**
 * The per-user secret ingest address (EI-186) — `<localPart>@in.myfaite.app`.
 *
 * **Deliberately NOT in `auth-schema.ts`.** That file is `better-auth
 * generate` output (`npm run auth:schema`) and is overwritten wholesale on
 * every regen, so a hand-added table there disappears the next time anyone
 * touches auth config. This file is listed separately in `drizzle.config.ts`
 * so its migration still lands in `drizzle/auth/` and the existing
 * `wrangler d1 migrations apply AUTH_DB` picks it up.
 *
 * It lives in D1 rather than the user's Durable Object because the lookup
 * runs BEFORE we know which user the mail is for — a DO is addressed by
 * `idFromName(userId)`, and resolving the local part is precisely how we
 * learn the userId. See `addresses.ts`.
 *
 * **This table holds no email content.** Local part, owner, timestamps,
 * counters — that is the whole surface. See `docs/EMAIL-INGEST.md` §Privacy.
 */
export const emailIngest = sqliteTable(
  "email_ingest",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * The secret. Unique across ALL rows including revoked ones, which is
     * what makes a burned address permanently unusable rather than merely
     * inactive — see `revokedAt`.
     */
    localPart: text("local_part").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /**
     * Set on rotation; the row is then kept FOREVER. Deleting it would free
     * the local part for reissue, so a leaked address could come back and
     * quietly start delivering to whoever drew it next. Rejecting on a
     * revoked row costs one nullable column.
     */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    /** Start of the current fixed rate window. See `addresses.ts`. */
    windowStart: integer("window_start", { mode: "timestamp_ms" }),
    /** Messages accepted so far inside `windowStart`'s window. */
    windowCount: integer("window_count").notNull().default(0),
  },
  (table) => [index("email_ingest_user_id_idx").on(table.userId)],
);
