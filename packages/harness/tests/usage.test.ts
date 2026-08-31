import { describe, it, expect } from "vitest";
import { z } from "zod";

import { claudeAdapter } from "../src/claude.js";
import { codexAdapter } from "../src/codex.js";
import { grokAdapter } from "../src/grok.js";
import { runHarness, type Spawner } from "../src/run.js";
import { toHarnessJsonSchema } from "../src/schema.js";
import type { CompletedProcess, HarnessUsage } from "../src/index.js";

function proc(stdout: string): CompletedProcess {
  return { stdout, stderr: "", code: 0 };
}

const CLAUDE_ENVELOPE = JSON.stringify({
  result: '{"v":"ok"}',
  total_cost_usd: 0.3501765,
  usage: {
    input_tokens: 4,
    cache_creation_input_tokens: 33217,
    cache_read_input_tokens: 33173,
    output_tokens: 56,
  },
});

describe("claude usage", () => {
  it("counts cached input as input, since it is billed", () => {
    const usage = claudeAdapter.extractUsage?.(proc(CLAUDE_ENVELOPE));
    // 4 + 33217 + 33173 — reporting only input_tokens would call a long
    // transcript nearly free.
    expect(usage?.inputTokens).toBe(66394);
    expect(usage?.outputTokens).toBe(56);
    expect(usage?.totalTokens).toBe(66450);
  });

  it("reports the dollar figure the CLI gives", () => {
    expect(claudeAdapter.extractUsage?.(proc(CLAUDE_ENVELOPE))?.costUsd).toBeCloseTo(0.3501765);
  });

  it("says nothing rather than guessing when stdout is not an envelope", () => {
    expect(claudeAdapter.extractUsage?.(proc("not json"))).toBeUndefined();
  });
});

describe("codex usage", () => {
  it("reads the token total out of its stdout banner", () => {
    const usage = codexAdapter.extractUsage?.(proc('codex\n{"v":"ok"}\ntokens used\n24,317\n'));
    expect(usage?.totalTokens).toBe(24317);
    // Codex reports no cost, and a made-up one would be worse than none.
    expect(usage?.costUsd).toBeUndefined();
  });

  it("says nothing when the banner is absent", () => {
    expect(codexAdapter.extractUsage?.(proc("codex\n{}"))).toBeUndefined();
  });
});

describe("grok usage", () => {
  it("reports nothing, because grok tells us nothing", () => {
    expect(grokAdapter.extractUsage).toBeUndefined();
  });
});

describe("runHarness reports usage", () => {
  const schema = z.object({ v: z.string() });

  it("hands the caller what the harness charged", async () => {
    const seen: HarnessUsage[] = [];
    const spawner: Spawner = async () => proc(CLAUDE_ENVELOPE);

    await runHarness("claude", { prompt: "go", schema, onUsage: (u) => seen.push(u) }, { spawner });

    expect(seen).toHaveLength(1);
    expect(seen[0].costUsd).toBeCloseTo(0.3501765);
  });

  it("stays quiet for a harness that reports nothing", async () => {
    const seen: HarnessUsage[] = [];
    const spawner: Spawner = async () => proc(JSON.stringify({ structuredOutput: { v: "ok" } }));

    await runHarness("grok", { prompt: "go", schema, onUsage: (u) => seen.push(u) }, { spawner });
    expect(seen).toEqual([]);
  });
});

// Codex rejects a schema without this, with a 400 naming response_format.
describe("schemas stay acceptable to codex", () => {
  it("closes every object it generates", () => {
    const json = toHarnessJsonSchema(z.object({ a: z.string() }));
    expect(json.additionalProperties).toBe(false);
  });

  it("keeps it closed through .extend, which the classify schema uses", () => {
    const extended = z.object({ a: z.string() }).extend({ b: z.array(z.enum(["x", "y"])) });
    const json = toHarnessJsonSchema(extended);
    expect(json.additionalProperties).toBe(false);
  });
});
