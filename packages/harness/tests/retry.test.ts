import { describe, it, expect } from "vitest";
import { z } from "zod";

import { classifyHarnessFailure, runHarness, type Spawner } from "../src/run.js";
import type { CompletedProcess } from "../src/types.js";

const schema = z.object({ verdict: z.string() });
const good = JSON.stringify({ structuredOutput: { verdict: "ok" } });

describe("classifyHarnessFailure", () => {
  it.each([
    ["HTTP 429 Too Many Requests", "a rate limit"],
    ["Error: rate_limit_exceeded", "an underscored rate limit"],
    ["upstream is overloaded, try again", "an overloaded upstream"],
    ["read ECONNRESET", "a reset connection"],
    ["connection refused", "a refused connection"],
    ["network error while streaming", "a network error"],
    ["the request timed out", "a timeout"],
    ["503 Service Unavailable", "a bad gateway family status"],
    ["temporarily unavailable", "a temporary outage"],
  ])("calls %j transient — %s", (text) => {
    expect(classifyHarnessFailure(text)).toBe("transient");
  });

  it.each([
    ["unknown option '--json-schema'", "a bad flag"],
    ["Invalid API key", "a credential fault"],
    ["", "silence"],
    ["error 5031 in module 2503", "digits that merely contain a status code"],
  ])("calls %j fatal — %s", (text) => {
    expect(classifyHarnessFailure(text)).toBe("fatal");
  });

  it("treats a run this process killed for exceeding its deadline as transient", () => {
    expect(classifyHarnessFailure("'claude' exceeded 600000ms and was killed")).toBe("transient");
  });
});

/** A spawner that answers from a script, one entry per attempt. */
function scripted(steps: Array<Partial<CompletedProcess> | Error>): {
  spawner: Spawner;
  attempts: () => number;
} {
  let attempt = 0;
  return {
    attempts: () => attempt,
    spawner: async () => {
      const step = steps[attempt++] ?? steps[steps.length - 1];
      if (step instanceof Error) throw step;
      return { stdout: "", stderr: "", code: 0, ...step };
    },
  };
}

describe("runHarness retry", () => {
  it("retries a transient failure and returns the attempt that worked", async () => {
    const { spawner, attempts } = scripted([
      { stdout: "", stderr: "HTTP 429 Too Many Requests", code: 1 },
      { stdout: good },
    ]);
    const slept: number[] = [];

    const result = await runHarness(
      "grok",
      { prompt: "go", schema },
      { spawner, sleep: async (ms) => void slept.push(ms) },
    );

    expect(result).toEqual({ verdict: "ok" });
    expect(attempts()).toBe(2);
    expect(slept).toEqual([5_000]);
  });

  it("gives up after three attempts, reporting the last failure", async () => {
    const { spawner, attempts } = scripted([{ stdout: "", stderr: "overloaded", code: 1 }]);
    const slept: number[] = [];

    await expect(
      runHarness("grok", { prompt: "go", schema }, { spawner, sleep: async (ms) => void slept.push(ms) }),
    ).rejects.toThrow(/overloaded/);

    expect(attempts()).toBe(3);
    expect(slept).toEqual([5_000, 15_000]);
  });

  it("does not retry a fatal failure, because the second attempt fails identically", async () => {
    const { spawner, attempts } = scripted([
      { stdout: "", stderr: "unknown option '--json-schema'", code: 2 },
    ]);
    const slept: number[] = [];

    await expect(
      runHarness("grok", { prompt: "go", schema }, { spawner, sleep: async (ms) => void slept.push(ms) }),
    ).rejects.toThrow(/unknown option/);

    expect(attempts()).toBe(1);
    expect(slept).toEqual([]);
  });

  it("does not retry a call whose side effects the caller cannot repeat", async () => {
    // A timeout is transient and a read-only step should try again. A step that
    // has been committing to a worktree cannot: the second attempt starts a
    // fresh conversation in a tree already carrying the first one's commits,
    // with no way to know they are there.
    const { spawner, attempts } = scripted([
      { stdout: "", stderr: "'claude' exceeded 5400000ms and was killed", code: 1 },
    ]);
    const slept: number[] = [];

    await expect(
      runHarness(
        "grok",
        { prompt: "go", schema, retry: false },
        { spawner, sleep: async (ms) => void slept.push(ms) },
      ),
    ).rejects.toThrow(/exceeded/);

    expect(attempts()).toBe(1);
    expect(slept).toEqual([]);
  });

  it("does not retry a payload the model shaped wrongly", async () => {
    const { spawner, attempts } = scripted([
      { stdout: JSON.stringify({ structuredOutput: { verdict: 7 } }) },
    ]);

    await expect(
      runHarness("grok", { prompt: "go", schema }, { spawner, sleep: async () => {} }),
    ).rejects.toThrow(/failed validation/);

    expect(attempts()).toBe(1);
  });

  it("retries a spawner that rejected, which is how a timeout arrives", async () => {
    const { spawner, attempts } = scripted([
      new Error("'grok' exceeded 600000ms and was killed"),
      { stdout: good },
    ]);

    const result = await runHarness(
      "grok",
      { prompt: "go", schema },
      { spawner, sleep: async () => {} },
    );

    expect(result).toEqual({ verdict: "ok" });
    expect(attempts()).toBe(2);
  });
});
