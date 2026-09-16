/**
 * Field projection shared by `?fields=` on `/api/v1` collections and the MCP
 * `fields` argument (EI-338 lists, EI-340 todos).
 *
 * Empty `fields` keeps every field. `omitNull` drops null-valued fields —
 * right for a model prompt, wrong for REST, whose published schemas say those
 * fields are nullable, not optional.
 */
export function projectRow<T extends object>(row: T, fields: readonly (keyof T)[], omitNull: boolean): Partial<T> {
  const keys = fields.length > 0 ? fields : (Object.keys(row) as (keyof T)[]);
  return Object.fromEntries(
    keys.filter((key) => !(omitNull && row[key] === null)).map((key) => [key, row[key]]),
  ) as Partial<T>;
}

/** `"a, b,,c"` → `["a", "b", "c"]`. */
export const splitCsv = (value: string | undefined): string[] =>
  value ? value.split(",").map((part) => part.trim()).filter(Boolean) : [];
