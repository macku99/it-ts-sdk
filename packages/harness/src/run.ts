import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAdapter } from "./index.js";
import { toHarnessJsonSchema } from "./schema.js";
import type {
  CompletedProcess,
  EncodedImage,
  HarnessName,
  HarnessRequest,
  HarnessScratch,
  ImageEncoding,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export type Spawner = (
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number; stdin?: string },
) => Promise<CompletedProcess>;

// JPEG covers every frame ffmpeg extracts today; the rest are here so a
// hand-passed image is not silently mislabelled to the model.
const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

function mediaTypeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) throw new Error(`unsupported image type for ${path}`);
  return mediaType;
}

// Bytes are read only for the harnesses that carry them. codex takes the path
// and opens the file itself, so encoding dozens of frames for it would be
// megabytes of pointless work.
async function encodeImages(paths: string[], encoding: ImageEncoding): Promise<EncodedImage[]> {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      mediaType: mediaTypeOf(path),
      base64: encoding === "base64" ? (await readFile(path)).toString("base64") : undefined,
    })),
  );
}

// How long to keep reading output after the process itself has exited. A
// grandchild that inherited the pipes keeps 'close' from ever firing, so the
// wait is bounded rather than open-ended.
const DRAIN_MS = 500;

// Children are detached so a timeout can kill the whole tree, which also means
// a terminal SIGINT never reaches them: it goes to this process's foreground
// group only. Left alone, Ctrl-C during a note write would abandon a harness
// running with --dangerously-skip-permissions inside the vault.
const liveKills = new Set<() => void>();
let signalsHooked = false;

function hookSignals(): void {
  if (signalsHooked) return;
  signalsHooked = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      for (const kill of liveKills) kill();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}

export const spawnHarness: Spawner = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    // Its own process group, so a timeout can take the whole tree. These CLIs
    // run arbitrary Bash and spawn MCP servers; killing only the direct child
    // leaves those holding the stdout pipe.
    // Spelled as two literal tuples rather than one computed array so the
    // typings still promise stdout and stderr are readable streams.
    const child =
      opts.stdin === undefined
        ? spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], detached: true })
        : spawn(bin, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });

    if (opts.stdin !== undefined) {
      // These CLIs wait for EOF before starting, so the pipe must be closed and
      // not merely written. A megabyte of frames outruns the pipe buffer, so an
      // EPIPE here means the child died early — the exit path already reports
      // that far better than an unhandled error would.
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.stdin);
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (drainTimer) clearTimeout(drainTimer);
      liveKills.delete(killTree);
      fn();
    };

    const settleWith = (code: number | null): void =>
      finish(() => {
        if (timedOut) {
          reject(new Error(`'${bin}' exceeded ${opts.timeoutMs}ms and was killed`));
        } else {
          resolve({ stdout, stderr, code });
        }
      });

    const killTree = (): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone, or never got its own group — fall back to the child.
        child.kill("SIGKILL");
      }
    };

    hookSignals();
    liveKills.add(killTree);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, opts.timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    child.on("error", (err) => {
      finish(() => reject(new Error(`failed to launch '${bin}': ${err.message}`)));
    });

    // 'exit' fires when the process itself terminates, whether or not anything
    // else still holds its pipes; 'close' waits for those pipes and may never
    // arrive. Settle on 'close' when it comes promptly, and on a drain timer
    // otherwise, so output is complete in the normal case and bounded always.
    child.on("exit", (code) => {
      // Stop the clock here: the process is gone, so a deadline elapsing during
      // the drain would otherwise reject a run that did produce output.
      clearTimeout(timer);
      drainTimer = setTimeout(() => settleWith(code), DRAIN_MS);
    });

    child.on("close", (code) => settleWith(code));
  });

// The posture is the important half: anything unrecognised is fatal. A misread fatal failure retried
// three times costs three identical failures and the wall-clock to discover it;
// a misread transient one fails a ticket that would have gone through.
//
// `exceeded …ms and was killed` is this process's own timeout message. A harness
// we killed for hanging is the textbook transient case — nothing about the
// request was wrong, it simply never came back.
const TRANSIENT = new RegExp(
  [
    "429",
    "rate.?limit",
    "too many requests",
    "overloaded",
    "econnreset",
    "connection (reset|refused|closed)",
    "network error",
    "timed? ?out",
    "temporarily unavailable",
    "service unavailable",
    "exceeded \\d+ms and was killed",
    // Bounded on both sides so a 503 is a status code and not four digits of
    // some unrelated number.
    "(^|[^0-9])50[23]([^0-9]|$)",
  ].join("|"),
  "i",
);

/** Whether a failed harness run is worth attempting again. */
export function classifyHarnessFailure(text: string): "transient" | "fatal" {
  return TRANSIENT.test(text) ? "transient" : "fatal";
}

const MAX_ATTEMPTS = 3;
// One short pause for a blip, one long one for a rate limit that needs a window
// to pass. A third would only postpone reporting a backend that is genuinely down.
const BACKOFF_MS = [5_000, 15_000];

/** Raised when the payload is wrong rather than the call — never retried. */
class PayloadError extends Error {}

export interface RunHarnessDeps {
  spawner?: Spawner;
  /** Test seam over the backoff wait. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Runs one LLM step on a headless CLI and returns a value the caller can trust.
// The harness is told the exact shape to produce via JSON Schema; whatever comes
// back is re-validated here, so a graph node never sees an unchecked object.
export async function runHarness<T>(
  harness: HarnessName,
  request: HarnessRequest<T>,
  deps: RunHarnessDeps = {},
): Promise<T> {
  const sleep = deps.sleep ?? wait;

  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptHarness(harness, request, deps);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const retryable =
        request.retry !== false
        && !(err instanceof PayloadError)
        && attempt < MAX_ATTEMPTS
        && classifyHarnessFailure(reason) === "transient";
      if (!retryable) throw err;

      const backoff = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      console.error(
        `${harness} failed transiently (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${backoff / 1000}s: ${reason.slice(0, 200)}`,
      );
      await sleep(backoff);
    }
  }
}

async function attemptHarness<T>(
  harness: HarnessName,
  request: HarnessRequest<T>,
  deps: RunHarnessDeps,
): Promise<T> {
  const adapter = getAdapter(harness);
  const spawner = deps.spawner ?? spawnHarness;
  const schemaJson = JSON.stringify(toHarnessJsonSchema(request.schema));

  const dir = await mkdtemp(join(tmpdir(), `it-harness-${harness}-`));
  const scratch: HarnessScratch = {
    schemaPath: join(dir, "schema.json"),
    resultPath: join(dir, "result.json"),
  };

  try {
    if (adapter.schemaOnDisk) {
      await writeFile(scratch.schemaPath, schemaJson, "utf8");
    }

    const images = request.imagePaths?.length
      ? await encodeImages(request.imagePaths, adapter.imageEncoding)
      : undefined;

    const { bin, args, stdin } = adapter.buildInvocation(request, schemaJson, scratch, images);

    const proc = await spawner(bin, args, {
      cwd: request.cwd,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      stdin,
    });

    // A bad flag or a rejected schema makes a CLI exit quietly with empty
    // stdout, which reads downstream as "response was not JSON". Attach the
    // exit code and stderr so the real cause is in the message.
    let payload: unknown;
    try {
      payload = await adapter.extractPayload(proc, () => readFile(scratch.resultPath, "utf8"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const tail = proc.stderr.trim().slice(-500);
      throw new Error(
        `${harness} produced no usable result (exit ${proc.code}): ${reason}`
          + (tail ? `\nstderr: ${tail}` : ""),
        { cause: err },
      );
    }

    // Reported before validation so a schema mismatch still accounts for what
    // the attempt cost.
    if (request.onUsage && adapter.extractUsage) {
      const usage = adapter.extractUsage(proc);
      if (usage) request.onUsage(usage);
    }

    // Before validation too: a run that answered in the wrong shape still
    // happened, and its session is what a fix step would resume.
    if (request.onSession && adapter.extractSession) {
      const session = adapter.extractSession(proc);
      if (session) request.onSession(session);
    }

    const parsed = request.schema.safeParse(payload);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      // Not retried: the call reached the model and the model answered. A
      // second identical prompt is a second coin flip, not a fix.
      throw new PayloadError(`${harness} returned a payload that failed validation: ${detail}`);
    }
    return parsed.data;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // best-effort; a leftover temp dir must never fail a run
    });
  }
}
