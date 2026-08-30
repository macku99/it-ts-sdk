import { describe, it, expect } from "vitest";
import { z } from "zod";

import { toHarnessJsonSchema } from "../src/schema.js";
import { runHarness, type Spawner } from "../src/run.js";
import type { CompletedProcess } from "../src/types.js";

const schema = z.object({ verdict: z.string(), score: z.number() });

function stubSpawner(
  proc: Partial<CompletedProcess>,
  capture?: (bin: string, args: string[]) => void,
): Spawner {
  return async (bin, args) => {
    capture?.(bin, args);
    return { stdout: "", stderr: "", code: 0, ...proc };
  };
}

describe("toHarnessJsonSchema", () => {
  it("drops the $schema meta-ref that Claude's validator rejects", () => {
    const json = toHarnessJsonSchema(schema) as Record<string, unknown>;
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
    expect(Object.keys(json.properties as object)).toEqual(["verdict", "score"]);
  });

  it("keeps the constraints the harness needs to honour", () => {
    const json = toHarnessJsonSchema(schema) as Record<string, unknown>;
    expect(json.required).toEqual(["verdict", "score"]);
  });
});

describe("runHarness", () => {
  it("returns data validated against the caller's schema", async () => {
    const stdout = JSON.stringify({ structuredOutput: { verdict: "ok", score: 3 } });
    const result = await runHarness(
      "grok",
      { prompt: "go", schema },
      { spawner: stubSpawner({ stdout }) },
    );
    expect(result).toEqual({ verdict: "ok", score: 3 });
  });

  it("rejects a payload that does not match the schema", async () => {
    const stdout = JSON.stringify({ structuredOutput: { verdict: "ok", score: "three" } });
    await expect(
      runHarness("grok", { prompt: "go", schema }, { spawner: stubSpawner({ stdout }) }),
    ).rejects.toThrow(/score.*expected number|failed validation/i);
  });

  it("never sends the $schema meta-ref to the harness", async () => {
    let seen: string[] = [];
    const stdout = JSON.stringify({ structuredOutput: { verdict: "ok", score: 1 } });
    await runHarness(
      "grok",
      { prompt: "go", schema },
      { spawner: stubSpawner({ stdout }, (_bin, args) => (seen = args)) },
    );
    const schemaArg = seen[seen.indexOf("--json-schema") + 1];
    expect(schemaArg).not.toContain("$schema");
    expect(JSON.parse(schemaArg).type).toBe("object");
  });

  it("surfaces exit code and stderr when the harness produces no usable output", async () => {
    const spawner = stubSpawner({
      stdout: "",
      stderr: "Error: --json-schema is not a valid JSON Schema",
      code: 1,
    });
    await expect(
      runHarness("claude", { prompt: "go", schema }, { spawner }),
    ).rejects.toThrow(/exit 1[\s\S]*not a valid JSON Schema/);
  });

  it("writes the schema to disk for harnesses that read it from a file", async () => {
    const { readFile } = await import("node:fs/promises");
    let schemaPath = "";
    let contents = "";
    const spawner: Spawner = async (_bin, args) => {
      schemaPath = args[args.indexOf("--output-schema") + 1];
      contents = await readFile(schemaPath, "utf8");
      const resultPath = args[args.indexOf("-o") + 1];
      const { writeFile } = await import("node:fs/promises");
      await writeFile(resultPath, JSON.stringify({ verdict: "ok", score: 2 }), "utf8");
      return { stdout: "banner noise", stderr: "", code: 0 };
    };

    const result = await runHarness("codex", { prompt: "go", schema }, { spawner });
    expect(result).toEqual({ verdict: "ok", score: 2 });
    expect(JSON.parse(contents).type).toBe("object");
    expect(JSON.parse(contents).$schema).toBeUndefined();
  });

  it("cleans up its scratch directory afterwards", async () => {
    const { access } = await import("node:fs/promises");
    let schemaPath = "";
    const spawner: Spawner = async (_bin, args) => {
      schemaPath = args[args.indexOf("--output-schema") + 1];
      const { writeFile } = await import("node:fs/promises");
      await writeFile(args[args.indexOf("-o") + 1], '{"verdict":"ok","score":1}', "utf8");
      return { stdout: "", stderr: "", code: 0 };
    };

    await runHarness("codex", { prompt: "go", schema }, { spawner });
    await expect(access(schemaPath)).rejects.toThrow();
  });
});
