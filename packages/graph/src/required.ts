/**
 * Reads a state channel a previous node was supposed to fill.
 *
 * Graph state channels are all optional until the node that owns them has run,
 * so every downstream node would otherwise open with the same hand-written
 * guard. Throwing here is caught by withNodeMiddleware and recorded as that
 * node's failure, which is what routes the run to reporting.
 */
export function required<T, K extends keyof T>(
  state: T,
  key: K,
  nodeName: string,
): NonNullable<T[K]> {
  const value = state[key];
  if (value === undefined || value === null) {
    throw new Error(`${nodeName} ran before '${String(key)}' was available`);
  }
  return value as NonNullable<T[K]>;
}
