import { describe, it, expect } from "vitest";

import { spawnHarness } from "../src/run.js";

// Everything here spawns node itself, never a real harness CLI, so the suite
// stays hermetic while still exercising the actual process plumbing.
const node = process.execPath;

describe("spawnHarness", () => {
  it("returns what the process wrote and its exit code", async () => {
    const proc = await spawnHarness(
      node,
      ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      { timeoutMs: 10_000 },
    );
    expect(proc).toEqual({ stdout: "out", stderr: "err", code: 0 });
  });

  it("reports a non-zero exit rather than throwing", async () => {
    const proc = await spawnHarness(node, ["-e", "process.exit(3)"], { timeoutMs: 10_000 });
    expect(proc.code).toBe(3);
  });

  it("explains a binary that could not be launched", async () => {
    await expect(
      spawnHarness("definitely-not-a-real-binary-xyz", [], { timeoutMs: 10_000 }),
    ).rejects.toThrow(/failed to launch 'definitely-not-a-real-binary-xyz'/);
  });

  it("kills a process that outlives its timeout", async () => {
    await expect(
      spawnHarness(node, ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 500 }),
    ).rejects.toThrow(/exceeded 500ms/);
  }, 15_000);

  // The failure the timeout exists to prevent: SIGKILL to the direct child alone
  // leaves a grandchild holding the stdout pipe, and waiting on 'close' then
  // never settles. This must reject promptly, not hang.
  it("still settles when a grandchild inherits the output pipe", async () => {
    const script = [
      "const { spawn } = require('child_process');",
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'],",
      "  { stdio: ['ignore', 'inherit', 'inherit'] });",
      "setTimeout(() => {}, 60000);",
    ].join("\n");

    const started = Date.now();
    await expect(
      spawnHarness(node, ["-e", script], { timeoutMs: 500 }),
    ).rejects.toThrow(/exceeded 500ms/);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 20_000);

  it("leaves no orphaned grandchild behind after a timeout", async () => {
    const marker = `harness-orphan-probe-${process.pid}`;
    const script = [
      "const { spawn } = require('child_process');",
      `spawn(process.execPath, ['-e', 'process.title = ${JSON.stringify(marker)};`,
      "  setTimeout(() => {}, 60000)'], { stdio: ['ignore', 'inherit', 'inherit'] });",
      "setTimeout(() => {}, 60000);",
    ].join("");

    await expect(
      spawnHarness(node, ["-e", script], { timeoutMs: 500 }),
    ).rejects.toThrow(/exceeded/);

    const { execFileSync } = await import("node:child_process");
    const survivors = execFileSync("/bin/ps", ["-ax", "-o", "command"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes(marker) && !line.includes("/bin/ps"));
    expect(survivors).toEqual([]);
  }, 20_000);
});
