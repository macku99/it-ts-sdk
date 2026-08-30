// Harnesses are asked for raw JSON, but a model occasionally wraps its answer
// in a markdown fence anyway. Strip one if present rather than failing a run
// over formatting the schema already constrained.
export function parseJsonLoose(text: string, context: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  try {
    return JSON.parse(unfenced);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const preview = unfenced.slice(0, 200);
    throw new Error(`${context}: response was not JSON (${reason}): ${preview}`);
  }
}
