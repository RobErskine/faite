import { z } from "zod";
import { listSchema, type List } from "@/lib/schema";

/**
 * `fields` + `includeArchived` for `GET /api/v1/lists` and the MCP
 * `list_lists` tool (EI-338). Pure, so both surfaces share one answer and
 * `list-query.test.ts` can pin it without a Durable Object.
 *
 * The two surfaces differ only in their DEFAULT fields. MCP defaults to the
 * four a router needs to pick a list — Pointer pastes the result into a model
 * prompt, and the full row was 16.5k characters for 31 lists. REST defaults
 * to the whole row, because the Raycast extension already reads `color`,
 * `emoji` and `tabId` from it.
 */

const LIST_FIELDS = Object.keys(listSchema.shape) as [keyof List, ...(keyof List)[]];
export const listFieldSchema = z.enum(LIST_FIELDS);
export type ListField = z.infer<typeof listFieldSchema>;

export const MCP_DEFAULT_LIST_FIELDS: ListField[] = ["id", "name", "description", "isBacklog"];

const FIELDS_DESCRIPTION = "Which fields to return for each list. Empty or omitted returns the default set.";
const ARCHIVED_DESCRIPTION = "Include archived lists. Default false.";

/** The MCP tool's input shape. */
export const listListsToolInput = {
  fields: z.array(listFieldSchema).optional().describe(`${FIELDS_DESCRIPTION} Default: id, name, description, isBacklog.`),
  includeArchived: z.boolean().optional().describe(ARCHIVED_DESCRIPTION),
};

/** The REST query string — documented from this object in `openapi/routes.ts`. */
export const listQuerySchema = z.object({
  fields: z
    .string()
    .optional()
    .describe(`${FIELDS_DESCRIPTION} Comma-separated, e.g. \`id,name,description\`. Default: every field.`),
  includeArchived: z.enum(["true", "false"]).optional().describe(ARCHIVED_DESCRIPTION),
});

export interface ListQuery {
  fields: ListField[];
  includeArchived: boolean;
}

/** `null` for an unknown field or a malformed flag, so the caller can 400. */
export function parseListQuery(params: URLSearchParams): ListQuery | null {
  const raw = listQuerySchema.safeParse({
    fields: params.get("fields") ?? undefined,
    includeArchived: params.get("includeArchived") ?? undefined,
  });
  if (!raw.success) return null;

  const names = raw.data.fields ? raw.data.fields.split(",").map((f) => f.trim()).filter(Boolean) : [];
  const fields = z.array(listFieldSchema).safeParse(names);
  if (!fields.success) return null;

  return { fields: fields.data, includeArchived: raw.data.includeArchived === "true" };
}

/**
 * Filters archived lists, then keeps only `fields` (all of them when empty).
 * `omitNull` drops null-valued fields — right for a prompt, wrong for REST,
 * whose published schema says those fields are nullable, not optional.
 */
export function projectLists(
  lists: List[],
  { fields, includeArchived, omitNull }: ListQuery & { omitNull: boolean },
): Partial<List>[] {
  const visible = includeArchived ? lists : lists.filter((list) => list.archivedAt === null);
  return visible.map((list) => {
    const keys = fields.length > 0 ? fields : (Object.keys(list) as ListField[]);
    return Object.fromEntries(
      keys.filter((key) => !(omitNull && list[key] === null)).map((key) => [key, list[key]]),
    ) as Partial<List>;
  });
}
