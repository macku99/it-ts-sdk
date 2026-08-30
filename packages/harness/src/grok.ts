import { resolveBinary } from "./bin.js";
import { resolveEffort } from "./effort.js";
import { parseJsonLoose } from "./json.js";
import type { EncodedImage, HarnessAdapter } from "./types.js";

// Grok's --prompt-json would take image bytes, but only on argv, and ARG_MAX is
// a hard 1 MiB kernel limit. Forty frames run to several megabytes even capped
// at 1568px, so that route cannot carry a real video and is not used. Grok is
// given the paths instead and opens the files with its own read tool.
function withImagePaths(prompt: string, images: EncodedImage[]): string {
  if (images.length === 0) return prompt;
  return [
    prompt,
    "",
    `${images.length} image(s) accompany this task. Read each file before answering:`,
    ...images.map((image) => `- ${image.path}`),
  ].join("\n");
}

// Grok takes the schema inline and returns an envelope that already carries the
// parsed object under `structuredOutput`, alongside the same JSON as `text`.
export const grokAdapter: HarnessAdapter = {
  name: "grok",
  schemaOnDisk: false,
  imageEncoding: "path",

  buildInvocation(request, schemaJson, _scratch, images = []) {
    // --json-schema implies --output-format json.
    const args = ["-p", withImagePaths(request.prompt, images), "--json-schema", schemaJson];

    if (request.systemPrompt) args.push("--system-prompt-override", request.systemPrompt);
    if (request.model) args.push("--model", request.model);
    if (request.effort) {
      args.push("--reasoning-effort", resolveEffort("grok", request.model, request.effort));
    }
    if (request.access === "write") args.push("--always-approve");
    else args.push("--disallowed-tools", "Write,Edit,Bash");

    return { bin: resolveBinary("grok"), args };
  },

  async extractPayload(proc) {
    const envelope = parseJsonLoose(proc.stdout, "grok") as {
      structuredOutput?: unknown;
      text?: unknown;
    };

    if (envelope.structuredOutput !== undefined) return envelope.structuredOutput;
    if (typeof envelope.text === "string") return parseJsonLoose(envelope.text, "grok text");
    throw new Error("grok returned neither structuredOutput nor text");
  },
};
