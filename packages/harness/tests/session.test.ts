import { describe, it, expect } from "vitest";
import { z } from "zod";

import { claudeAdapter } from "../src/claude.js";
import { codexAdapter } from "../src/codex.js";
import { grokAdapter } from "../src/grok.js";
import { runHarness, type Spawner } from "../src/run.js";
import type { CompletedProcess, HarnessRequest, HarnessScratch } from "../src/types.js";

const scratch: HarnessScratch = { schemaPath: "/tmp/w/schema.json", resultPath: "/tmp/w/result.json" };
const schema = z.object({ verdict: z.string() });
const schemaJson = '{"type":"object"}';

function request(overrides: Partial<HarnessRequest<unknown>> = {}): HarnessRequest<unknown> {
  return { prompt: "carry on", schema, ...overrides };
}

function proc(overrides: Partial<CompletedProcess> = {}): CompletedProcess {
  return { stdout: "", stderr: "", code: 0, ...overrides };
}

/** What claude answers with; the session id is a sibling of the result. */
const envelope = (session: string) =>
  JSON.stringify({
    type: "result",
    is_error: false,
    session_id: session,
    result: JSON.stringify({ verdict: "ok" }),
  });

describe("claude session capture", () => {
  it("reads the session id off the result envelope", () => {
    expect(claudeAdapter.extractSession?.(proc({ stdout: envelope("b2ea56d9-765c") })))
      .toBe("b2ea56d9-765c");
  });

  it("reads it off the last event of a stream, not the init line", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "old" }),
      envelope("b2ea56d9-765c"),
    ].join("\n");

    expect(claudeAdapter.extractSession?.(proc({ stdout }))).toBe("b2ea56d9-765c");
  });

  it("answers with nothing when the run never reported one", () => {
    expect(claudeAdapter.extractSession?.(proc({ stdout: "banner text" }))).toBeUndefined();
  });
});

describe("claude session resume", () => {
  it("resumes the named session", () => {
    const { args } = claudeAdapter.buildInvocation(
      request({ resumeSession: "b2ea56d9-765c" }),
      schemaJson,
      scratch,
    );

    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("b2ea56d9-765c");
  });

  it("starts fresh when no session is named", () => {
    const { args } = claudeAdapter.buildInvocation(request(), schemaJson, scratch);

    expect(args).not.toContain("--resume");
  });
});

describe("harnesses without a session store", () => {
  it.each([
    ["codex", codexAdapter],
    ["grok", grokAdapter],
  ])("%s ignores a session id rather than passing an unknown flag", (_name, adapter) => {
    const fresh = adapter.buildInvocation(request(), schemaJson, scratch);
    const resumed = adapter.buildInvocation(
      request({ resumeSession: "b2ea56d9-765c" }),
      schemaJson,
      scratch,
    );

    // They carry prior artifacts in the prompt instead; inventing a flag here
    // would make every resumed call fail at argument parsing.
    expect(resumed.args).toEqual(fresh.args);
  });

  it.each([
    ["codex", codexAdapter],
    ["grok", grokAdapter],
  ])("%s reports no session to resume", (_name, adapter) => {
    expect(adapter.extractSession).toBeUndefined();
  });
});

describe("runHarness session reporting", () => {
  it("hands the session id to the caller that asked for it", async () => {
    const spawner: Spawner = async () => proc({ stdout: envelope("b2ea56d9-765c") });
    const seen: string[] = [];

    await runHarness(
      "claude",
      { prompt: "go", schema, onSession: (id) => void seen.push(id) },
      { spawner },
    );

    expect(seen).toEqual(["b2ea56d9-765c"]);
  });

  it("says nothing when the harness reports no session", async () => {
    const spawner: Spawner = async () =>
      proc({ stdout: JSON.stringify({ structuredOutput: { verdict: "ok" } }) });
    const seen: string[] = [];

    await runHarness(
      "grok",
      { prompt: "go", schema, onSession: (id) => void seen.push(id) },
      { spawner },
    );

    expect(seen).toEqual([]);
  });
});
