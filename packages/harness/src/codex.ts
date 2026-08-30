import { resolveBinary } from "./bin.js";
import { resolveEffort } from "./effort.js";
import { parseJsonLoose } from "./json.js";
import type { HarnessAdapter } from "./types.js";

// Codex takes its schema as a file and writes the final message to another file.
// Its stdout carries a banner, hook lines, and a token count, so the answer is
// read from disk rather than scraped.
export const codexAdapter: HarnessAdapter = {
  name: "codex",
  schemaOnDisk: true,
  // The only one that opens the files itself, so frames cost nothing to pass
  // and no size ceiling applies.
  imageEncoding: "path",

  buildInvocation(request, _schemaJson, scratch, images = []) {
    const args = [
      "exec",
      "--output-schema",
      scratch.schemaPath,
      "-o",
      scratch.resultPath,
      "--skip-git-repo-check",
      "--sandbox",
      request.access === "write" ? "danger-full-access" : "read-only",
    ];

    if (request.model) args.push("--model", request.model);
    // Codex has no effort flag; it takes one as a config override, which is the
    // same channel its own docs use for the setting.
    if (request.effort) {
      args.push(
        "-c",
        `model_reasoning_effort=${resolveEffort("codex", request.model, request.effort)}`,
      );
    }

    // Codex has no separate system-prompt flag; prepend it to the instructions.
    const prompt = request.systemPrompt
      ? `${request.systemPrompt}\n\n---\n\n${request.prompt}`
      : request.prompt;

    if (images.length === 0) {
      args.push(prompt);
      return { bin: resolveBinary("codex"), args };
    }

    // -i is variadic, so it eats any positional that follows — including the
    // prompt. Codex reads the prompt from stdin when none is given.
    args.push("-i", ...images.map((image) => image.path));
    return { bin: resolveBinary("codex"), args, stdin: prompt };
  },

  // Codex prints a bare "tokens used\n<n>" line and no cost.
  extractUsage(proc) {
    // Its banner names the model; the token line comes at the end.
    const model = proc.stdout.match(/^model:\s*(\S+)/m)?.[1];
    const match = proc.stdout.match(/tokens used\s*\n\s*([\d,]+)/);
    const total = match ? Number(match[1].replace(/,/g, "")) : undefined;

    if (model === undefined && total === undefined) return undefined;
    return {
      ...(model === undefined ? {} : { model }),
      ...(total === undefined || !Number.isFinite(total) ? {} : { totalTokens: total }),
    };
  },

  async extractPayload(proc, readResultFile) {
    let raw: string;
    try {
      raw = await readResultFile();
    } catch {
      const tail = proc.stderr.trim().slice(-400) || proc.stdout.trim().slice(-400);
      throw new Error(`codex wrote no result file (exit ${proc.code}): ${tail}`);
    }
    return parseJsonLoose(raw, "codex result");
  },
};
