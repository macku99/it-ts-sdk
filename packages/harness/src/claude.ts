import { resolveBinary } from "./bin.js";
import { resolveEffort } from "./effort.js";
import { parseJsonLoose } from "./json.js";
import type { HarnessAdapter } from "./types.js";

// The single-envelope and streaming channels differ only in where the envelope
// sits: alone on stdout, or as the `type: "result"` line among many. Everything
// downstream reads the same fields, so both extractors resolve it here first.
// Splitting on newlines is safe: a newline inside a JSON string value is the
// two characters \ and n, not a line break.
function streamedLines(stdout: string): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        lines.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Banner text or a truncated final line; neither is an event.
    }
  }
  return lines;
}

function resultEnvelope(stdout: string): Record<string, unknown> | undefined {
  const text = stdout.trim();
  if (text.length === 0) return undefined;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // JSONL: the run's summary is the last result event, and everything before
    // it is init and per-turn chatter.
    return streamedLines(text)
      .toReversed()
      .find((line) => line.type === "result");
  }
}

// True when stdout is a stream of events rather than one envelope. Lets a run
// that died mid-stream be reported as such, instead of as malformed JSON.
function isStreamed(stdout: string): boolean {
  return streamedLines(stdout).some((line) => typeof line.type === "string");
}

// An error envelope carries `result` as text for a plain refusal and as a
// structured object for a rate or turn limit. Stringifying the object form
// gives "[object Object]", hiding the reason the run failed.
function describeResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return "unknown";
  return JSON.stringify(result);
}

// Claude Code answers on stdout as a result envelope whose `result` field holds
// the schema-constrained JSON as a *string*, so the payload needs a second parse.
export const claudeAdapter: HarnessAdapter = {
  name: "claude",
  schemaOnDisk: false,
  imageEncoding: "base64",

  buildInvocation(request, schemaJson, _scratch, images = []) {
    // The CLI has no flag for a local image — `--file` downloads an uploaded
    // resource by id. The streaming input channel is the only way to put pixels
    // in front of the model, and it forces streaming output with it, so stdout
    // becomes JSONL. Both extractors below handle either shape.
    const streaming = images.length > 0;

    const args = streaming
      ? [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--json-schema",
          schemaJson,
        ]
      : ["-p", request.prompt, "--output-format", "json", "--json-schema", schemaJson];

    if (request.systemPrompt) args.push("--append-system-prompt", request.systemPrompt);
    if (request.model) args.push("--model", request.model);
    if (request.effort) {
      args.push("--effort", resolveEffort("claude", request.model, request.effort));
    }
    // The session store lives under CLAUDE_CONFIG_DIR: the same id under a
    // different account exits 1 with "No conversation found". The model and
    // effort flags above still govern the resumed turn.
    if (request.resumeSession) args.push("--resume", request.resumeSession);

    const allowTools = request.allowTools ?? [];
    if (request.access === "write") {
      args.push("--allowedTools", "Read", "Write", "Edit", "Glob", "Grep", "Bash", ...allowTools);
      args.push("--dangerously-skip-permissions");
      for (const dir of request.extraDirs ?? []) args.push("--add-dir", dir);
    } else {
      // -p carries the editing tools by default, so a read-only step has to
      // deny them rather than simply not ask for them.
      // A denylist, unlike codex's deny-by-default sandbox. The network tools
      // are named too: a classify prompt carries a whole transcript, so an
      // exfiltration-shaped call is the one worth closing.
      args.push(
        "--disallowedTools",
        "Write",
        "Edit",
        "NotebookEdit",
        "Bash",
        "WebFetch",
        "WebSearch",
      );
      // Denied is the default for anything not built in: a reading step that
      // wants the symbol tools has to be told it may have them.
      if (allowTools.length > 0) args.push("--allowedTools", ...allowTools);
    }

    if (!streaming) return { bin: resolveBinary("claude"), args };

    // One user message carrying the images ahead of the prompt text, which is
    // the order the Agent SDK used and the order the model reads best.
    const message = {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: request.prompt },
          ...images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.base64 },
          })),
        ],
      },
    };

    return { bin: resolveBinary("claude"), args, stdin: `${JSON.stringify(message)}\n` };
  },

  // The only harness that reports a dollar figure of its own.
  extractUsage(proc) {
    const envelope = resultEnvelope(proc.stdout) as
      | {
          type?: unknown;
          usage?: Record<string, unknown>;
          total_cost_usd?: unknown;
          modelUsage?: Record<string, unknown>;
        }
      | undefined;
    if (!envelope) return undefined;
    // A run that only got as far as its init event carries no totals. Costs are
    // reported per run, so half of one is worse than none.
    if (typeof envelope.type === "string" && envelope.type !== "result") return undefined;

    const usage = envelope.usage ?? {};
    const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    // Cache reads and writes are billed input; counting only input_tokens would
    // report a long transcript as costing almost nothing.
    const cacheCreate = num(usage.cache_creation_input_tokens) ?? 0;
    const cacheRead = num(usage.cache_read_input_tokens) ?? 0;
    const totalIn = input === undefined ? undefined : input + cacheCreate + cacheRead;

    return {
      // Keyed by the resolved model name, e.g. claude-opus-5.
      model: Object.keys(envelope.modelUsage ?? {})[0],
      inputTokens: totalIn,
      outputTokens: output,
      totalTokens: totalIn === undefined || output === undefined ? undefined : totalIn + output,
      costUsd: num(envelope.total_cost_usd),
    };
  },

  // Reported on the result envelope, and unchanged by a resume — the same id
  // keeps naming the conversation as it grows.
  extractSession(proc) {
    const envelope = resultEnvelope(proc.stdout) as { session_id?: unknown } | undefined;
    return typeof envelope?.session_id === "string" ? envelope.session_id : undefined;
  },

  async extractPayload(proc) {
    const found = resultEnvelope(proc.stdout);

    // A stream that was cut off has events but no summary. Naming that beats
    // reporting the init line as malformed JSON.
    if (!found && isStreamed(proc.stdout)) {
      throw new Error("claude streamed its run but never reported a result");
    }

    const envelope = (found ?? parseJsonLoose(proc.stdout, "claude")) as {
      is_error?: boolean;
      result?: unknown;
    };

    // A refusal, rate limit, or turn-limit exit still exits 0 with a populated
    // envelope. Report that text rather than letting it fail schema validation
    // as unparseable JSON.
    if (envelope.is_error === true) {
      throw new Error(`claude reported an error: ${describeResult(envelope.result)}`);
    }

    const { result } = envelope;
    if (typeof result === "string") return parseJsonLoose(result, "claude result");
    if (result === undefined) throw new Error("claude returned no result field");
    return result;
  },
};
