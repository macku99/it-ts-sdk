import { describe, it, expect, vi } from "vitest";

import { required, withNodeMiddleware } from "../src/index.js";
import type { NodeFailure, TracedState } from "../src/index.js";

// A minimal state to exercise the wrapper with, standing in for whatever a real
// worm tracks alongside trace and failure.
interface ProbeState extends TracedState {
  note?: { note_path: string; insight_count: number };
}

const emptyState: ProbeState = { trace: [] };

describe("withNodeMiddleware", () => {
  it("passes the node's own update through untouched apart from the trace", async () => {
    const node = withNodeMiddleware<ProbeState>("classify", async () => ({
      note: { note_path: "/v/a.md", insight_count: 3 },
    }));
    const update = await node(emptyState);
    expect(update.note).toEqual({ note_path: "/v/a.md", insight_count: 3 });
  });

  it("stamps the node name and its duration onto the trace", async () => {
    const node = withNodeMiddleware<ProbeState>("classify", async () => ({}));
    const update = await node(emptyState);
    expect(update.trace?.[0]).toMatch(/^classify \(\d+\.\ds\)$/);
  });

  it("keeps the detail a node reports alongside the name", async () => {
    const node = withNodeMiddleware<ProbeState>("classify", async () => ({
      trace: ["matched=true → systems"],
    }));
    expect(firstTraceLine(await node(emptyState))).toMatch(
      /^classify \(\d+\.\ds\): matched=true → systems$/,
    );
  });

  // Recorded rather than thrown, so the graph can still reach its reporting
  // node. A thrown node aborts the run and nothing gets told about it.
  it("records a failure against the node that raised it", async () => {
    const node = withNodeMiddleware<ProbeState>("write_note", async () => {
      throw new Error("harness timed out");
    });
    const update = await node(emptyState);

    expect(update.failure).toMatchObject({ node: "write_note", message: "harness timed out" });
    // The error itself is kept, so a reporter can recognise a known kind of
    // failure rather than only quoting its message.
    expect(update.failure?.cause).toBeInstanceOf(Error);
  });

  it("does not reject, so downstream routing still gets to run", async () => {
    const node = withNodeMiddleware<ProbeState>("write_note", async () => {
      throw new Error("harness timed out");
    });
    await expect(node(emptyState)).resolves.toBeDefined();
  });

  it("puts the failure in the trace alongside its timing", async () => {
    const node = withNodeMiddleware<ProbeState>("write_note", async () => {
      throw new Error("harness timed out");
    });
    const update = await node(emptyState);

    expect(update.trace?.[0]).toMatch(/^write_note \(\d+\.\ds\): FAILED — harness timed out$/);
  });

  function firstTraceLine(u: { trace?: string[] }): string {
    return u.trace?.[0] ?? "";
  }
});

describe("required", () => {
  it("returns the value when the preceding node supplied it", () => {
    expect(required({ a: 1 }, "a", "classify")).toBe(1);
  });

  it("explains which node is missing which input", () => {
    expect(() => required({ a: undefined }, "a", "classify")).toThrow(/classify.*\ba\b/);
  });
});

// The reason these live in src/middlewares rather than inside a worm: they know
// only about `trace` and `failure`, so any worm's state satisfies them.
describe("worm-agnostic", () => {
  // Structurally a TracedState without declaring it, which is the point: the
  // middleware works for a state it has never heard of. The failure channel is
  // NodeFailure rather than a narrower hand-written shape because the wrapper
  // always records a cause, and a state that cannot hold one loses it.
  interface OtherWormState {
    trace: string[];
    failure?: NodeFailure | undefined;
    ticketId: string;
    patch?: string;
  }

  it("wraps a node whose state belongs to a different worm", async () => {
    const node = withNodeMiddleware<OtherWormState>("apply_patch", async (state) => ({
      patch: `patch for ${state.ticketId}`,
      trace: ["3 files changed"],
    }));

    const update = await node({ trace: [], ticketId: "IT-42" });

    expect(update.patch).toBe("patch for IT-42");
    expect(update.trace?.[0]).toMatch(/^apply_patch \(\d+\.\ds\): 3 files changed$/);
  });

  it("records that worm's failures the same way", async () => {
    const node = withNodeMiddleware<OtherWormState>("apply_patch", async () => {
      throw new Error("merge conflict");
    });

    const update = await node({ trace: [], ticketId: "IT-42" });

    expect(update.failure).toMatchObject({ node: "apply_patch", message: "merge conflict" });
    expect(update.failure?.cause).toBeInstanceOf(Error);
    expect(update.patch).toBeUndefined();
  });
});

// The graph builds a per-node trace and the CLI prints it at the end — but the
// daemon calls the graph directly, so its log went silent for the whole run.
// A six-minute ingestion showed the harness plan and then nothing until it
// finished. Each node reports as it lands.
describe("progress reaches the log as it happens", () => {
  it("reports a node the moment it completes, not at the end of the run", async () => {
    const lines: string[] = [];
    const node = withNodeMiddleware(
      "fetch",
      async () => ({ trace: ['"A Talk" 34:10, 40 frames'] }),
      {
        log: (line) => lines.push(line),
      },
    );

    await node({ trace: [] });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("fetch");
    expect(lines[0]).toContain("A Talk");
  });

  it("reports a failure the same way, rather than only recording it", async () => {
    const lines: string[] = [];
    const node = withNodeMiddleware(
      "classify",
      async () => {
        throw new Error("harness timed out");
      },
      { log: (line) => lines.push(line) },
    );

    await node({ trace: [] });

    expect(lines[0]).toMatch(/classify.*FAILED.*harness timed out/);
  });

  it("logs the same text it records, so the two never disagree", async () => {
    const lines: string[] = [];
    const node = withNodeMiddleware("publish", async () => ({ trace: ["synced"] }), {
      log: (line) => lines.push(line),
    });

    const update = await node({ trace: [] });

    expect(lines[0]).toBe(update.trace?.[0]);
  });
});

// A worm whose stdout carries a machine-readable protocol has nowhere to put a
// progress line: one console.log from the middleware lands between two JSON
// objects and the consumer parsing them fails. Diagnostics go to stderr, which
// is what stderr is for, and a caller wanting them elsewhere injects a log.
describe("where the default log writes", () => {
  it("writes progress to stderr, leaving stdout to the caller", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const outSpy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      out.push(line);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation((line: string) => {
      err.push(line);
    });

    try {
      await withNodeMiddleware("classify", async () => ({}))({ trace: [] });
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^\[graph\] classify/);
  });
});
