import PostalMime from "postal-mime";
import { MAX_RAW_SIZE_BYTES } from "@/lib/email-limits";
import { createTodo, pushTransportFor } from "../service/todos";
import { serverHlcClock } from "../service/hlc";
import {
  decideIngest,
  loadByLocalPart,
  localPartHash,
  markAccepted,
  splitRecipient,
} from "./addresses";
import { emailToTodoInput } from "./parse";

/**
 * `email()`'s body — forward a message to your secret address, get a todo in
 * Backlog (EI-186).
 *
 * Orchestration only; every decision worth testing lives in a pure module
 * beside this one (`addresses.ts`, `parse.ts`), the same split
 * `places/routes.ts` makes against `places/validate.ts`.
 *
 * ```
 * size guard → resolve local part → rate window → parse → map → push()
 * ```
 *
 * **The write goes through `push()`, not a DO table write.** That is not a
 * style preference: `push()` is what allocates a `version` from `sync_meta`
 * and writes `field_clocks`. A direct write skips both, so no device ever
 * pulls the todo (their cursor is already past it) and the next client push
 * wins the field-level comparison by default and erases it. See
 * `docs/API.md`'s "The thing that will go wrong". Routing through `push()`
 * also gets the P4 broadcast for free — the todo appears on an open board
 * live, without a reload.
 */

/** Re-exported for the tests and for symmetry with the other guards; the
 * number and its reasoning live in `@/lib/email-limits`. */
export { MAX_RAW_SIZE_BYTES } from "@/lib/email-limits";

/**
 * The single SMTP reason for every address-resolution failure.
 *
 * Unknown and revoked are logged distinctly and rejected identically. A
 * distinguishable bounce would tell someone probing the catch-all which of
 * their guesses had once been a real address — a free oracle against the one
 * secret this feature has.
 */
const REJECT_UNKNOWN = "no such recipient";

/**
 * **Every `setReject()` in this file is a PERMANENT SMTP error.** Cloudflare's
 * `ForwardableEmailMessage` has no defer/4xx API — "Reject emails with a
 * permanent SMTP error" is the whole contract. So a rejected message is
 * destroyed, the sender does not retry, and the reason string below is the
 * only explanation anyone ever gets. Word them as final, never as "try again":
 * a reason that invites a retry that cannot happen is worse than no reason.
 */
const REJECT_RATE_LIMITED = "too many messages this hour — this one was not delivered";
const REJECT_INTERNAL = "could not be processed";

/**
 * Module-scoped so successive messages handled by the same isolate get
 * strictly increasing HLCs even inside one millisecond. Correct across
 * isolates too, for creates specifically — see `service/hlc.ts` for why that
 * is safe here and not in general.
 */
const nextHlc = serverHlcClock();

/**
 * What we are allowed to write to Workers Logs.
 *
 * `observability.enabled` is on in `wrangler.jsonc`, so console output AND
 * uncaught exception messages are captured and retained. Subject, body, and
 * sender must therefore never reach a log line — including via a thrown
 * error's message, which is why `handleEmail` catches everything itself
 * rather than letting anything escape into the runtime's own reporting.
 * `addressHash` is a truncated digest, not the address.
 */
interface IngestLog {
  decision: string;
  addressHash?: string;
  userId?: string;
  rawSize: number;
}

function log(entry: IngestLog): void {
  console.log(`[faite] email-ingest ${JSON.stringify(entry)}`);
}

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: CloudflareEnv,
): Promise<void> {
  const receivedAt = new Date();
  const rawSize = message.rawSize;

  try {
    if (rawSize > MAX_RAW_SIZE_BYTES) {
      message.setReject("message too large — attachments are not supported");
      log({ decision: "too-large", rawSize });
      return;
    }

    // Declared in `wrangler.jsonc`'s `vars`, so it is always present. Checked
    // rather than assumed: a catch-all is only a catch-all for the domain it
    // was configured on, and accepting mail for any other hostname would mean
    // trusting whatever `to` a relay handed us.
    const recipient = splitRecipient(message.to, env.EMAIL_INGEST_DOMAIN);
    if (!recipient) {
      message.setReject(REJECT_UNKNOWN);
      log({ decision: "bad-recipient", rawSize });
      return;
    }

    const addressHash = await localPartHash(recipient.key);
    const row = await loadByLocalPart(env.AUTH_DB, recipient.key);
    const decision = decideIngest(row, receivedAt.getTime());

    if (!decision.ok) {
      message.setReject(
        decision.reason === "rate-limited" ? REJECT_RATE_LIMITED : REJECT_UNKNOWN,
      );
      log({ decision: decision.reason, addressHash, rawSize });
      return;
    }

    // Committed BEFORE the parse and the push, so a message that goes on to
    // blow up still spends its slot. The alternative — only counting
    // successes — makes a stream of malformed mail free, which is exactly
    // the traffic the cap exists to stop.
    await markAccepted(env.AUTH_DB, decision.addressId, decision.next, receivedAt.getTime());

    // Streamed and parsed in memory. `message.raw` is read exactly here and
    // is never written anywhere; `parsed.attachments` is never read at all.
    //
    // EI-242 added an R2 bucket for todo attachments, which removes the old
    // reason for that ("there is no blob store") and not the current one:
    // nothing authenticates a sender here, so honouring `parsed.attachments`
    // would be an unauthenticated write into billed storage with none of the
    // magic-byte checking `/api/attachments` does. See docs/EMAIL-INGEST.md.
    const parsed = await PostalMime.parse(message.raw);

    const input = emailToTodoInput(parsed, [], {
      receivedAt: receivedAt.toISOString(),
      envelopeFrom: message.from,
      tag: recipient.tag,
    });

    const stub = env.USER_DO.get(env.USER_DO.idFromName(decision.userId));
    // Resolved from the authoritative store rather than left to
    // `buildCreateTodoEntry`'s fallback, which is the constant `"a0"` — see
    // `user-do.ts`'s `nextTodoPosition`.
    const position = await stub.nextTodoPosition();

    const { response } = await createTodo(
      { userId: decision.userId, nextHlc },
      { ...input, position },
      pushTransportFor(stub, decision.userId),
    );

    if (response.rejected.length > 0) {
      // Our own builder produced an entry the DO refused — a bug here, not
      // bad input. Reject so the message bounces rather than vanishing.
      message.setReject("could not be filed");
      log({ decision: "push-rejected", addressHash, userId: decision.userId, rawSize });
      return;
    }

    log({ decision: "accepted", addressHash, userId: decision.userId, rawSize });
  } catch (error) {
    // **Deliberately swallows the error object.** An exception thrown while
    // parsing carries fragments of the message in its own `message` field,
    // and an uncaught one is captured verbatim by Workers Logs. Log the shape
    // of the failure, never its contents.
    log({ decision: "error", rawSize });
    console.error(`[faite] email-ingest failed: ${errorLabel(error)}`);
    // NOT "try again later" — see REJECT_INTERNAL. `setReject` is permanent,
    // so telling the sender to retry is a promise the protocol cannot keep.
    message.setReject(REJECT_INTERNAL);
  }
}

/** The error's constructor name and nothing else. `error.message` from a MIME
 * parser routinely quotes the bytes it choked on. */
function errorLabel(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}
