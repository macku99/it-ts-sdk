import type { GraphNode, TracedState } from "./types.js";

/**
 * Timing, naming and error attribution for one graph node.
 *
 * LangGraph has no middleware of its own — a node is just a function — so the
 * concerns every node shares live in one wrapper rather than being copied into
 * each. A node reports what it found; this adds who reported it and how long it
 * took.
 *
 * A failure is recorded into state instead of rethrown, because a thrown node
 * aborts the graph before any reporting node can run, which is precisely when
 * somebody needs to be told.
 *
 * Each line is also written out as it happens. The trace survives to the end of
 * the run for whoever wants the whole story, but a caller that only reads the
 * final state — the daemon does — would otherwise show nothing at all while a
 * six-minute ingestion is under way.
 */
export interface NodeMiddlewareDeps {
  log?: (line: string) => void;
}

export function withNodeMiddleware<S extends TracedState>(
  name: string,
  fn: GraphNode<S>,
  deps: NodeMiddlewareDeps = {},
): GraphNode<S> {
  const log = deps.log ?? ((line: string) => console.log(`[graph] ${line}`));

  return async (state: S) => {
    const started = Date.now();
    const elapsed = (): string => ((Date.now() - started) / 1000).toFixed(1);

    try {
      const update = await fn(state);
      const detail = update.trace?.join("; ");
      const line = `${name} (${elapsed()}s)${detail ? `: ${detail}` : ""}`;
      log(line);
      return { ...update, trace: [line] } as Partial<S>;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const line = `${name} (${elapsed()}s): FAILED — ${reason}`;
      log(line);
      return {
        failure: { node: name, message: reason, cause: err },
        trace: [line],
      } as Partial<S>;
    }
  };
}
