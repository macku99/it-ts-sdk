# @itfrombit/graph

Timing, naming and error attribution for a LangGraph node, in one wrapper.

```bash
npm install @itfrombit/graph
```

```ts
import { withNodeMiddleware, required } from "@itfrombit/graph";

const classify = withNodeMiddleware("classify", async (state) => {
  const video = required(state, "fetched", "classify");

  return { classification: await decide(video), trace: ["matched"] };
});
```

## What it handles

LangGraph has no middleware of its own — a node is just a function — so the
concerns every node shares live here rather than being copied into each one. A
node reports what it found; this adds who reported it and how long it took.

A thrown node is **recorded into state, not rethrown**. LangGraph has no error
edge, and a node that throws aborts the run before any reporting node can
run — which is precisely when somebody needs to be told what happened. The
failure lands on the `failure` channel carrying the original error, so a
reporter can recognise a known kind rather than only quoting a message.

Progress is written out as it happens, on **stderr**. A caller reading only the
final state would otherwise show nothing at all while a six-minute run is under
way, and stdout is left alone so a CLI can carry a machine-readable protocol
there. Pass your own `log` to send it elsewhere.

`required` reads a state channel a previous node was supposed to fill. Graph
channels are all optional until their owning node has run, so every downstream
node would otherwise open with the same hand-written guard.

The middleware knows only about `trace` and `failure`, so any graph's state
satisfies it.

## API

`withNodeMiddleware`, `required`, and the `GraphNode` / `NodeFailure` /
`TracedState` types.

MIT licensed. Part of [it-ts-sdk](https://github.com/macku99/it-ts-sdk).
