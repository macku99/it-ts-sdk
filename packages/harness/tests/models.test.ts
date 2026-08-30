import { describe, it, expect } from "vitest";

import { HARNESS_NAMES } from "../src/index.js";
import { KNOWN_MODELS, SKIP_CHECK_ENV, checkModel, modelFor } from "../src/models.js";
import { preflightModels } from "../src/preflight.js";

describe("checkModel", () => {
  it("accepts an alias that tracks the latest release", () => {
    expect(checkModel("claude", "opus", {})).toBeUndefined();
    expect(checkModel("claude", "sonnet", {})).toBeUndefined();
  });

  it("accepts a pinned full name", () => {
    expect(checkModel("claude", "claude-opus-5", {})).toBeUndefined();
    expect(checkModel("codex", "gpt-5.6-sol", {})).toBeUndefined();
    expect(checkModel("grok", "grok-4.5", {})).toBeUndefined();
  });

  it("rejects a typo and lists what it does know", () => {
    const message = checkModel("claude", "opuss", {});
    expect(message).toMatch(/'opuss' is not a known claude model/);
    expect(message).toMatch(/opus/);
  });

  it("points at the file to edit when a model is newer than the list", () => {
    expect(checkModel("grok", "grok-9", {})).toMatch(/@it-core\/harness's src\/models\.ts/);
  });

  it("keeps harnesses separate, since a name valid for one is not for another", () => {
    expect(checkModel("grok", "opus", {})).toBeDefined();
    expect(checkModel("claude", "grok-4.5", {})).toBeDefined();
  });

  // A new release must not block work until someone edits this repository.
  it("stands aside when the check is explicitly skipped", () => {
    expect(checkModel("claude", "opus-6-unreleased", { [SKIP_CHECK_ENV]: "1" })).toBeUndefined();
  });

  it("offers the escape hatch in the rejection message", () => {
    expect(checkModel("claude", "opuss", {})).toContain(SKIP_CHECK_ENV);
  });

  it("lists a model for every harness, so none is unusable by default", () => {
    for (const [harness, models] of Object.entries(KNOWN_MODELS)) {
      expect(models.length, `${harness} has no known models`).toBeGreaterThan(0);
    }
  });
});

describe("preflightModels against the list", () => {
  it("costs no calls at all — the check is a lookup", async () => {
    let probed = 0;
    await preflightModels(
      [
        { harness: "claude", model: "opus" },
        { harness: "codex", model: "gpt-5.6-sol" },
      ],
      { probe: async () => void probed++ },
    );
    expect(probed).toBe(0);
  });

  it("still reports every bad model at once", async () => {
    const error = await preflightModels([
      { harness: "claude", model: "opuss" },
      { harness: "grok", model: "grok-99" },
    ]).catch((e: Error) => e);

    expect((error as Error).message).toMatch(/claude:opuss/);
    expect((error as Error).message).toMatch(/grok:grok-99/);
  });

  it("ignores a node that pinned nothing", async () => {
    await expect(
      preflightModels([{ harness: "claude" }, { harness: "grok" }]),
    ).resolves.toBeUndefined();
  });

  it("uses a live probe only when one is asked for", async () => {
    const probed: string[] = [];
    await preflightModels([{ harness: "claude", model: "opus" }], {
      probe: async (h, m) => void probed.push(`${h}:${m}`),
      live: true,
    });
    expect(probed).toEqual(["claude:opus"]);
  });
});

describe("modelFor", () => {
  it("spends claude's real size ladder, which is where a tier actually buys something", () => {
    expect(modelFor("claude", "small")).toBe("haiku");
    expect(modelFor("claude", "medium")).toBe("sonnet");
    expect(modelFor("claude", "large")).toBe("opus");
  });

  it("spends codex's 5.6 variants, which are a size ladder wearing three names", () => {
    // Not a mechanical reading of their descriptions: small starts at terra,
    // not the cheaper luna, which puts a quality floor under the lowest tier.
    expect(modelFor("codex", "small")).toBe("gpt-5.6-terra");
    expect(modelFor("codex", "medium")).toBe("gpt-5.6-sol");
    expect(modelFor("codex", "large")).toBe("gpt-5.6-sol");
  });

  it("gives grok's smaller work its older release", () => {
    expect(modelFor("grok", "small")).toBe("grok-4.5");
    expect(modelFor("grok", "medium")).toBe("grok-4.6");
    expect(modelFor("grok", "large")).toBe("grok-4.6");
  });

  it("never leaves a class unpinned, whatever the harness", () => {
    // Unset takes the CLI's own default, which is its newest flagship rather
    // than the model a tier was costed against.
    for (const harness of HARNESS_NAMES) {
      for (const cls of ["small", "medium", "large"] as const) {
        expect(modelFor(harness, cls)).toBeTruthy();
      }
    }
  });

  it("resolves every class to a model the allowlist knows", () => {
    // The two tables drift apart silently otherwise: the class table keeps
    // naming a model `checkModel` has stopped recognising.
    for (const harness of HARNESS_NAMES) {
      for (const cls of ["small", "medium", "large"] as const) {
        expect(checkModel(harness, modelFor(harness, cls), {})).toBeUndefined();
      }
    }
  });
});
