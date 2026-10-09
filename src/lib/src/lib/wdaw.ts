import { z } from "zod";

/** Task metadata, not account identities or authorization grants. */
export const taskActorSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(["human", "agent"]),
  name: z.string().min(1).max(200),
}).strict();

const routeUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Use an HTTP(S) link without embedded credentials");

export const taskReferenceSchema = z.object({
  type: z.enum(["link", "todo", "email", "linear"]),
  label: z.string().min(1).max(500),
  url: routeUrlSchema.optional(),
  id: z.string().min(1).max(500).optional(),
}).strict().refine((reference) => reference.url !== undefined || reference.id !== undefined,
  "A reference needs a URL or source ID");

export const taskWhySchema = z.object({
  text: z.string().max(10000),
  references: z.array(taskReferenceSchema).max(100),
  /** Caller-reported provenance. Not an authenticated audit log. */
  log: z.array(z.object({
    id: z.string().min(1).max(200),
    text: z.string().min(1).max(10000),
    addedBy: taskActorSchema,
    addedAt: z.iso.datetime(),
  }).strict()).max(100),
}).strict();

export const taskDoneSchema = z.array(z.object({
  id: z.string().min(1).max(200),
  text: z.string().min(1).max(2000),
  passed: z.boolean(),
  addedBy: taskActorSchema,
  addedAt: z.iso.datetime(),
}).strict()).max(100).refine((items) => new Set(items.map((item) => item.id)).size === items.length,
  "Criteria IDs must be unique");

export const taskAccessStateSchema = z.enum(["declared", "available", "needs-setup", "blocked"]);
export const taskAccessSchema = z.array(z.object({
  id: z.string().min(1).max(200),
  capability: z.string().min(1).max(500),
  source: z.string().min(1).max(500),
  state: taskAccessStateSchema,
  fixUrl: routeUrlSchema.nullable(),
  /** State is worker-reported, never a Faite access check. */
  reportedBy: taskActorSchema,
  reportedAt: z.iso.datetime(),
}).strict()).max(100).refine((items) => new Set(items.map((item) => item.id)).size === items.length,
  "Capability IDs must be unique");

export const taskWhoSchema = z.object({
  doer: taskActorSchema.nullable(),
  reviewer: taskActorSchema.nullable(),
}).strict();

/** No defaults: an old row or a sparse patch must stay exactly as it was. */
export const wdawFields = {
  why: taskWhySchema.nullable().optional(),
  done: taskDoneSchema.nullable().optional(),
  access: taskAccessSchema.nullable().optional(),
  who: taskWhoSchema.nullable().optional(),
};
