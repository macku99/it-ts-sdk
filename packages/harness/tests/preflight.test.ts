import { describe, it, expect } from "vitest";

import { preflightModels } from "../src/preflight.js";
import type { HarnessName } from "../src/index.js";

interface Probe {
  harness: HarnessName;
  model: string;
}

function probeRecorder(reject: string[] = []) {
  const seen: Probe[] = [];
  const probe = async (harness: HarnessName, model: string): Promise<void> => {
    seen.push({ harness, model });
    if (reject.includes(model)) throw new Error(`unknown model id '${model}'`);
  };
  return { probe, seen };
}

describe("preflightModels with a live probe", () => {
  it("probes nothing when no node pinned a model", async () => {
    const { probe, seen } = probeRecorder();
    await preflightModels([{ harness: "claude" }, { harness: "codex" }], { probe, live: true });
    // An unpinned node uses the CLI's own default, which is valid by definition.
    expect(seen).toEqual([]);
  });

  it("probes each pinned model once, not once per node using it", async () => {
    const { probe, seen } = probeRecorder();
    await preflightModels(
      [
        { harness: "claude", model: "opus" },
        { harness: "claude", model: "opus" },
        { harness: "claude", model: "sonnet" },
      ],
      { probe, live: true },
    );
    expect(seen).toEqual([
      { harness: "claude", model: "opus" },
      { harness: "claude", model: "sonnet" },
    ]);
  });

  it("treats the same model name on different harnesses as separate", async () => {
    const { probe, seen } = probeRecorder();
    await preflightModels(
      [
        { harness: "claude", model: "fast" },
        { harness: "grok", model: "fast" },
      ],
      { probe, live: true },
    );
    expect(seen).toHaveLength(2);
  });

  it("passes silently when every pinned model is good", async () => {
    const { probe } = probeRecorder();
    await expect(
      preflightModels([{ harness: "claude", model: "opus" }], { probe, live: true }),
    ).resolves.toBeUndefined();
  });

  it("names the bad model and the harness that rejected it", async () => {
    const { probe } = probeRecorder(["opuss"]);
    await expect(
      preflightModels([{ harness: "claude", model: "opuss" }], { probe, live: true }),
    ).rejects.toThrow(/claude:opuss.*unknown model id/s);
  });

  // One run should not have to be repeated three times to find three typos.
  it("reports every bad model at once rather than only the first", async () => {
    const { probe } = probeRecorder(["opuss", "grok-99"]);
    const error = await preflightModels(
      [
        { harness: "claude", model: "opuss" },
        { harness: "codex", model: "gpt-5.6-sol" },
        { harness: "grok", model: "grok-99" },
      ],
      { probe, live: true },
    ).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/claude:opuss/);
    expect((error as Error).message).toMatch(/grok:grok-99/);
    expect((error as Error).message).not.toMatch(/gpt-5\.6-sol/);
  });
});
