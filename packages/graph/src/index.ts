// Cross-cutting behaviour shared by every worm's graph nodes. A middleware only
// one worm needs belongs in that worm's own middlewares folder instead.
export { withNodeMiddleware } from "./node-trace.js";
export { required } from "./required.js";
export type { GraphNode, NodeFailure, TracedState } from "./types.js";
