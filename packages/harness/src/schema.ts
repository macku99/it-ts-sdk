import { z } from "zod";

// Zod stamps a `$schema` meta-ref (draft 2020-12) onto everything it generates.
// Claude Code's validator resolves that ref against its own registry and fails
// the whole invocation with "no schema with key or ref ..."; codex and grok
// ignore it. None of the three need the annotation, so it is dropped for all.
export function toHarnessJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _dropped, ...rest } = json;
  return rest;
}
