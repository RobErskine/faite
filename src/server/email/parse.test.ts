import { describe, expect, it } from "vitest";
import type { Email } from "postal-mime";
import { parseSource } from "@/lib/capture-source";
import {
  bodyText,
  descriptionFor,
  emailToTodoInput,
  htmlToText,
  MAX_DESCRIPTION_BYTES,
  titleFor,
} from "./parse";

const CONTEXT = {
  receivedAt: "2026-08-17T12:00:00.000Z",
  envelopeFrom: "envelope@example.com",
  tag: null,
};

/** Minimal `Email` — postal-mime always populates these two arrays. */
function email(fields: Partial<Email>): Email {
  return { headers: [], headerLines: [], attachments: [], ...fields };
}

describe("titleFor", () => {
  it("uses the trimmed subject", () => {
    expect(titleFor("  Buy milk  ", "body")).toBe("Buy milk");
  });

  it("falls back to the first non-blank body line when the subject is empty", () => {
    expect(titleFor("   ", "\n\n  pick up the dry cleaning\nand the mail")).toBe(
      "pick up the dry cleaning",
    );
  });

  it("falls back again when there is no subject and no body", () => {
    expect(titleFor(undefined, "")).toBe("(no subject)");
    expect(titleFor(undefined, "   \n\n  ")).toBe("(no subject)");
  });

  it("caps at 200 characters", () => {
    expect(titleFor("x".repeat(500), "")).toHaveLength(200);
  });
});

describe("bodyText", () => {
  it("prefers the text part", () => {
    expect(bodyText({ text: "plain", html: "<p>rich</p>" })).toBe("plain");
  });

  it("falls back to a tag-stripped html part", () => {
    expect(bodyText({ text: undefined, html: "<p>rich</p>" })).toBe("rich");
  });

  it("falls back to html when the text part is present but blank", () => {
    expect(bodyText({ text: "   \n ", html: "<p>rich</p>" })).toBe("rich");
  });

  it("is empty when the message has neither part", () => {
    expect(bodyText({})).toBe("");
  });
});

describe("htmlToText", () => {
  it("drops script and style CONTENT, not just their tags", () => {
    const html = "<style>p{color:red}</style><script>alert(1)</script><p>Hello</p>";
    expect(htmlToText(html)).toBe("Hello");
  });

  it("turns block ends and breaks into newlines", () => {
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one\ntwo");
    expect(htmlToText("a<br>b")).toBe("a\nb");
  });

  it("decodes named and numeric entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &#8212; &#x263A; &nbsp;done</p>")).toBe(
      "Tom & Jerry — ☺ done",
    );
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(htmlToText("<p>&notarealentity;</p>")).toBe("&notarealentity;");
  });

  it("collapses the blank-line storm that stripping a table produces", () => {
    const html = "<div>a</div><div></div><div></div><div></div><div>b</div>";
    expect(htmlToText(html)).toBe("a\n\nb");
  });
});

describe("descriptionFor", () => {
  it("is null for an empty body, matching a todo with no notes", () => {
    expect(descriptionFor("")).toBeNull();
  });

  it("passes a normal body through untouched", () => {
    expect(descriptionFor("hello")).toBe("hello");
  });

  it("truncates a body over the cap and says so", () => {
    const result = descriptionFor("a".repeat(MAX_DESCRIPTION_BYTES * 2));
    expect(result).not.toBeNull();
    expect(result!.endsWith("— truncated")).toBe(true);
    expect(new TextEncoder().encode(result!).length).toBeLessThanOrEqual(MAX_DESCRIPTION_BYTES);
  });

  it("never splits a multi-byte codepoint at the cap", () => {
    // Every character is 4 UTF-8 bytes, so the budget lands mid-codepoint
    // unless the truncation is byte-aware.
    const result = descriptionFor("🙂".repeat(MAX_DESCRIPTION_BYTES));
    expect(result).not.toBeNull();
    expect(new TextEncoder().encode(result!).length).toBeLessThanOrEqual(MAX_DESCRIPTION_BYTES);
    expect(result).not.toContain("�");
  });
});

describe("emailToTodoInput", () => {
  it("maps a plain forwarded message", () => {
    const input = emailToTodoInput(
      email({
        subject: "Buy milk",
        text: "from the good place",
        messageId: "<t1@example.com>",
        from: { name: "Rob", address: "rob@example.com" },
      }),
      [],
      CONTEXT,
    );

    expect(input.title).toBe("Buy milk");
    expect(input.description).toBe("from the good place");
    // Backlog is the DEFAULT column for a null listId — see board.ts:518,694.
    // Guessing an id would render the todo in no column at all.
    expect(input.listId).toBeNull();
    // Left to the caller: the builder's fallback is the constant "a0".
    expect(input.position).toBeUndefined();
  });

  it("records provenance in a parseable source blob", () => {
    const input = emailToTodoInput(
      email({
        subject: "Buy milk",
        text: "body",
        messageId: "<t1@example.com>",
        from: { name: "Rob", address: "rob@example.com" },
      }),
      [],
      CONTEXT,
    );

    const source = parseSource(input.source ?? null);
    expect(source).not.toBeNull();
    expect(source!.kind).toBe("email");
    expect(source!.at).toBe(CONTEXT.receivedAt);
    expect(source!.email).toEqual({
      from: "rob@example.com",
      subject: "Buy milk",
      messageId: "<t1@example.com>",
    });
  });

  it("falls back to the envelope sender when the From header has no address", () => {
    const input = emailToTodoInput(email({ subject: "s", text: "b" }), [], CONTEXT);
    expect(parseSource(input.source ?? null)!.email!.from).toBe("envelope@example.com");
  });

  it("handles a From header that is a group rather than a mailbox", () => {
    const input = emailToTodoInput(
      email({
        subject: "s",
        text: "b",
        from: { name: "Team", group: [{ name: "A", address: "a@example.com" }] },
      }),
      [],
      CONTEXT,
    );
    expect(parseSource(input.source ?? null)!.email!.from).toBe("a@example.com");
  });

  it("keeps the source blob under serializeSource's 2 KB cap on a huge subject", () => {
    const input = emailToTodoInput(
      email({ subject: "x".repeat(50_000), text: "b", messageId: "y".repeat(50_000) }),
      [],
      CONTEXT,
    );
    expect(new TextEncoder().encode(input.source!).length).toBeLessThanOrEqual(2048);
    // Still parses — a blob truncated into invalid JSON would render as no
    // captured context at all.
    expect(parseSource(input.source ?? null)).not.toBeNull();
  });

  it("derives a title from the body of an html-only message with no subject", () => {
    const input = emailToTodoInput(
      email({ html: "<p>Renew the passport</p><p>before October</p>" }),
      [],
      CONTEXT,
    );
    expect(input.title).toBe("Renew the passport");
    expect(input.description).toBe("Renew the passport\nbefore October");
  });

  it("applies rules when any are supplied — the seam for the follow-up ticket", () => {
    const input = emailToTodoInput(email({ subject: "s", text: "b" }), [{ listId: "list-1" }], CONTEXT);
    expect(input.listId).toBe("list-1");
  });
});
