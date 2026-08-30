// What went wrong, and where. A node failure is recorded rather than thrown so
// a graph can still reach its reporting node — LangGraph has no error edge, and
// a thrown node aborts the run before anything can be said about it.
export interface NodeFailure {
  node: string;
  message: string;
  // The error itself, kept so a reporter can recognise a known kind and say
  // what to do about it. A message alone has already lost that.
  cause?: unknown;
}

// The two channels every worm's graph state carries, so the middlewares below
// work for any of them without knowing what else a worm tracks.
export interface TracedState {
  trace: string[];
  failure?: NodeFailure | undefined;
}

// A LangGraph node: given the state so far, report what this step established.
export type GraphNode<S extends TracedState> = (state: S) => Promise<Partial<S>>;
