/**
 * Generates a DRAFT OpenAPI 3.1 document from `src/lib/schema.ts`'s existing
 * Zod schemas — the P5 (EI-50, scoped-down) proof that this pipeline works,
 * not a finished public spec. Nothing imports the output; no route serves
 * it. Run by hand:
 *
 *   npm run openapi:generate
 *
 * ## Why `zod-openapi`, checked against the current ecosystem rather than
 * assumed
 *
 * Zod v4 (this repo pins `^4.4.3`) ships a native `z.toJSONSchema()` plus a
 * `.meta()`/`z.globalRegistry` metadata system, which changed the landscape
 * from Zod v3: the older `@asteasolutions/zod-to-openapi` needed
 * `extendZodWithOpenApi()` to monkey-patch Zod with an `.openapi()` method
 * (v8 of that package now supports `.meta()` too, but as a bolt-on).
 * `zod-openapi` (`samchungy/zod-openapi`, v6.0.1 as of writing) was built
 * around Zod v4's native registry from the start — no monkey-patching, and
 * its only peer dependency is `zod: ^4.0.0`, which is exactly what this repo
 * already has. That is why it's the pick here over hand-rolling on top of
 * `z.toJSONSchema()` (would mean reimplementing path/components/security
 * assembly) or the older `@asteasolutions` package (solving a problem
 * `.meta()` already solves).
 *
 * ## Why this only builds `Todo`'s paths
 *
 * The pattern (`.meta({ id })` a schema, reference it from a path) is
 * mechanical to repeat for the other eight syncable entities in
 * `src/lib/schema.ts`. Building only the flagship one out keeps this
 * reviewable, matching the same scope line the service layer
 * (`src/lib/service/todos.ts`) and the token model draw.
 *
 * ## Deliberately excluded from every schema below
 *
 * `version` and `hlc` never appear — not because they were stripped, but
 * because `src/lib/schema.ts`'s Zod models never had them in the first
 * place (`version` is a DO-only SQLite column; HLCs are wire-only, see
 * `SERVER_ONLY_FIELDS` in `lib/sync/wire.ts`). That happens to match
 * docs/API.md's own lean ("a documented API probably wants an opaque
 * `updatedAt` and nothing else — exposing the clock makes it a
 * compatibility surface forever") with zero extra work here, which is worth
 * calling out precisely because it's not something this script had to
 * decide.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDocument } from "zod-openapi";
import {
  dayNoteSchema,
  idSchema,
  labelSchema,
  listSchema,
  placeSchema,
  projectSchema,
  reminderPresetSchema,
  settingsSchema,
  tabSchema,
  todoSchema,
} from "@/lib/schema";
import { z } from "zod";

// `.meta({ id })` registers each schema in Zod's global registry under that
// name, which is what lets `zod-openapi` emit `$ref: "#/components/schemas/Todo"`
// instead of inlining the same shape at every use site. Mutates the schema
// objects imported above IN PLACE (Zod's registry is keyed by object
// identity) — safe because nothing else in the app ever reads
// `z.globalRegistry`; this script is the only consumer.
todoSchema.meta({ id: "Todo", description: "A to-do item." });
listSchema.meta({ id: "List", description: "A planning-half column." });
labelSchema.meta({ id: "Label", description: "A multi-assign tag." });
projectSchema.meta({ id: "Project", description: "A cross-cutting bucket of todos." });
tabSchema.meta({ id: "Tab", description: "A group of planning-half columns." });
dayNoteSchema.meta({ id: "DayNote", description: "A calendar day's journal entry." });
placeSchema.meta({ id: "Place", description: "A saved, named address." });
reminderPresetSchema.meta({ id: "ReminderPreset", description: "A named reminder time." });
settingsSchema.meta({ id: "Settings", description: "Per-user settings." });

// Illustrative create-input shape — NOT the wire format (a real write is a
// `push()`, per docs/API.md; see `src/lib/service/todos.ts`'s
// `CreateTodoInput`, which this mirrors by hand for the same reason that
// module can't import the other's types — different runtime boundaries, not
// a shared source. `.meta()`'d separately from `Todo` itself since a create
// request and the resulting resource are different shapes (no `id`,
// `ownerId`, timestamps, or the fields the server alone decides).
const createTodoInputSchema = todoSchema
  .pick({
    title: true,
    description: true,
    priority: true,
    scheduledDate: true,
    deadline: true,
    listId: true,
    projectId: true,
    labelIds: true,
    location: true,
    placeId: true,
    reminderTime: true,
  })
  .partial({
    description: true,
    priority: true,
    scheduledDate: true,
    deadline: true,
    listId: true,
    projectId: true,
    labelIds: true,
    location: true,
    placeId: true,
    reminderTime: true,
  })
  .meta({ id: "CreateTodoInput", description: "Fields accepted when creating a todo." });

const document = createDocument({
  openapi: "3.1.0",
  info: {
    title: "Faite API (draft)",
    version: "0.0.0-draft",
    description:
      "DRAFT. Generated from src/lib/schema.ts by scripts/openapi/generate.ts " +
      "(EI-50 P5, scoped down). No route in this app currently serves this " +
      "surface — see docs/API.md before treating any path below as real.",
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      // Matches the token model's `Authorization: Bearer <token>` shape —
      // see `src/server/auth-tokens.ts`. That plugin is registered and its
      // D1 table is real, but `enableSessionForAPIKeys: false` keeps it from
      // affecting any existing route; nothing currently issues 401s against
      // this scheme.
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "An API token minted via the (currently unwired) api-key plugin " +
          "in src/server/auth-tokens.ts. Draft — no route enforces this yet.",
      },
    },
    schemas: {
      Todo: todoSchema,
      List: listSchema,
      Label: labelSchema,
      Project: projectSchema,
      Tab: tabSchema,
      DayNote: dayNoteSchema,
      Place: placeSchema,
      ReminderPreset: reminderPresetSchema,
      Settings: settingsSchema,
      CreateTodoInput: createTodoInputSchema,
    },
  },
  paths: {
    "/todos": {
      get: {
        tags: ["todos"],
        summary: "List the caller's todos (DRAFT — unimplemented).",
        operationId: "listTodos",
        responses: {
          "200": {
            description: "Todos, newest-updated first.",
            content: { "application/json": { schema: z.array(todoSchema) } },
          },
        },
      },
      post: {
        tags: ["todos"],
        summary: "Create a todo (DRAFT — unimplemented).",
        description:
          "Per docs/API.md, this is NOT a direct database write — it would " +
          "construct a PushEntry and go through the same push() path sync " +
          "uses, via src/lib/service/todos.ts's buildCreateTodoEntry(). See " +
          "that module for the still-open question of who stamps the HLC.",
        operationId: "createTodo",
        requestBody: {
          content: { "application/json": { schema: createTodoInputSchema } },
        },
        responses: {
          "201": {
            description: "The created todo.",
            content: { "application/json": { schema: todoSchema } },
          },
        },
      },
    },
    "/todos/{id}": {
      get: {
        tags: ["todos"],
        summary: "Fetch one todo (DRAFT — unimplemented).",
        operationId: "getTodo",
        requestParams: {
          path: z.object({ id: idSchema }),
        },
        responses: {
          "200": {
            description: "The todo.",
            content: { "application/json": { schema: todoSchema } },
          },
          "404": { description: "No such todo, or it belongs to a different account." },
        },
      },
    },
  },
});

async function main() {
  const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../openapi/openapi.json");
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(document, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outFile}`);
}

await main();
