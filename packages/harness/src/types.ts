import type { z } from "zod";

// A harness is a headless coding CLI the graph shells out to for one LLM step.
// Every harness takes a prompt plus a JSON Schema and hands back an object
// matching it; the differences are confined to argv and to where the answer
// lands (stdout field vs. file on disk).
export type HarnessName = "claude" | "codex" | "grok";

// Whether the step may modify the filesystem. Classification reads nothing and
// writes nothing; note-writing needs the vault. Each adapter maps this onto its
// own permission flags, which are spelled differently for all three CLIs.
export type HarnessAccess = "read-only" | "write";

// How hard the model should think, in our vocabulary rather than any one CLI's.
// All three harnesses have this knob and spell it three ways, so the request
// names a level and the adapter emits its own flag — the same arrangement
// `HarnessAccess` already has. The list is the union of what they publish, and
// their ceilings differ, so the most a given model offers is reached by asking
// for the top of this list and letting it clamp.
export type HarnessEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface HarnessRequest<T> {
  prompt: string;
  // The shape the final answer must take. Doubles as the JSON Schema handed to
  // the CLI and as the validator applied to whatever comes back.
  schema: z.ZodType<T>;
  systemPrompt?: string;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  // "read-only" is enforced by every adapter, but not equally: codex narrows its
  // sandbox and is deny-by-default, while claude and grok deny a named list of
  // tools, so anything a future release adds is permitted until listed here.
  access?: HarnessAccess;
  // Honoured by all three, spelled differently by each. A level the *model* does
  // not offer is clamped down to the nearest it does, so an unsupported level
  // costs less than asked rather than more. Which levels exist depends on the
  // model and not only the harness, so `model` decides how this resolves.
  effort?: HarnessEffort;
  // Whether a transient failure may be tried again. True unless said otherwise,
  // which is right for a step that only reads: a timeout or a 429 costs nothing
  // to repeat. A step that has been writing to a worktree is the other case —
  // the retry starts a fresh conversation in a tree already carrying the first
  // attempt's commits, with no way to know they are there — so it sets this
  // false and lets the caller decide what continuing means.
  retry?: boolean;
  // Called with whatever the harness reported about the run's cost, when it
  // reports anything. Never called for a harness that says nothing.
  onUsage?: (usage: HarnessUsage) => void;
  // Continue a previous conversation instead of starting one. Only claude has a
  // session store; codex and grok silently start fresh, so a step that depends
  // on continuity has to carry its prior artifacts in the prompt for them.
  //
  // The store lives under CLAUDE_CONFIG_DIR, so a resumed call must run under
  // the same account as the call that created the session; under another it
  // exits non-zero with "No conversation found". Resuming by id works from any
  // working directory, though a step that writes should still run where the
  // conversation did, since that is where it believes it is. The `model` and
  // `effort` of the resumed turn are this request's own, not the original's.
  resumeSession?: string;
  // Called with the session this run belongs to, for a later `resumeSession`.
  // Never called for a harness that keeps no sessions.
  onSession?: (sessionId: string) => void;
  // Tools the step is approved to call, by name or glob (`mcp__serena__*`).
  // claude's -p mode denies any tool nobody allowed — an MCP tool above all —
  // whether or not the step may write, so a grounded step has to name the
  // symbol tools here or it runs on file reads alone. codex and grok have no
  // equivalent and ignore this.
  allowTools?: string[];
  // Extra reachable directories, honoured only by claude's --add-dir. codex and
  // grok have no equivalent, so for those `cwd` is what actually grants access —
  // set it to the directory the step must work in.
  extraDirs?: string[];
  // Images to put in front of the model alongside the prompt. Every adapter
  // reshapes its whole invocation when these are present rather than appending
  // a flag, so the three diverge more here than anywhere else.
  imagePaths?: string[];
}

// An image prepared for one adapter. `base64` is filled in only for the
// harnesses that carry bytes; codex is handed the path and opens it itself.
export interface EncodedImage {
  path: string;
  mediaType: string;
  base64?: string;
}

// Whether an adapter wants the file's bytes or just its location.
export type ImageEncoding = "path" | "base64";

// Running one step on one harness. Named so callers can take it as a
// dependency and be driven by a fake, rather than reaching for the module.
export type HarnessRunner = <T>(harness: HarnessName, request: HarnessRequest<T>) => Promise<T>;

// What a run cost, as far as the harness will say. Every field is optional
// because the three disagree: claude reports tokens and a dollar figure, codex
// only a total token count, grok nothing at all.
export interface HarnessUsage {
  // The model the harness reports having actually used, which is the useful
  // fact — a request pins an alias, or pins nothing at all.
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

// Temp paths for harnesses that exchange structured data through the filesystem.
export interface HarnessScratch {
  schemaPath: string;
  resultPath: string;
}

export interface HarnessInvocation {
  bin: string;
  args: string[];
  // Written to the child's stdin and then closed. Two CLIs need this once
  // images are attached: claude takes the whole message as streaming JSON, and
  // codex's variadic -i would swallow a positional prompt.
  stdin?: string;
}

export interface CompletedProcess {
  stdout: string;
  stderr: string;
  code: number | null;
}

// Per-CLI behaviour, kept as two pure-ish functions so argv construction and
// payload extraction are unit-testable without spawning anything.
export interface HarnessAdapter {
  readonly name: HarnessName;
  // Does this CLI need the JSON Schema written to disk before invocation?
  readonly schemaOnDisk: boolean;
  // Does this CLI want image bytes or an image path? Reading and encoding
  // megabytes of frames is wasted work for the one that takes paths.
  readonly imageEncoding: ImageEncoding;
  buildInvocation(
    request: HarnessRequest<unknown>,
    schemaJson: string,
    scratch: HarnessScratch,
    images?: EncodedImage[],
  ): HarnessInvocation;
  extractPayload(proc: CompletedProcess, readResultFile: () => Promise<string>): Promise<unknown>;
  // Tokens and cost, where the CLI surfaces them. Undefined when it does not.
  extractUsage?(proc: CompletedProcess): HarnessUsage | undefined;
  // The session this run belongs to. Absent on adapters whose CLI keeps none,
  // which is how a caller learns that resuming is not available there.
  extractSession?(proc: CompletedProcess): string | undefined;
}
