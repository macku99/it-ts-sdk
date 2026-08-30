import { describe, it, expect } from "vitest";
import { z } from "zod";

import { resolveBinary } from "../src/bin.js";
import { claudeAdapter } from "../src/claude.js";
import { codexAdapter } from "../src/codex.js";
import { grokAdapter } from "../src/grok.js";
import { getAdapter, HARNESS_NAMES } from "../src/index.js";
import type { CompletedProcess, HarnessRequest, HarnessScratch } from "../src/types.js";

const scratch: HarnessScratch = {
  schemaPath: "/tmp/w/schema.json",
  resultPath: "/tmp/w/result.json",
};

const schema = z.object({ verdict: z.string() });
const schemaJson = '{"type":"object"}';

function request(overrides: Partial<HarnessRequest<unknown>> = {}): HarnessRequest<unknown> {
  return { prompt: "classify this", schema, ...overrides };
}

function proc(overrides: Partial<CompletedProcess> = {}): CompletedProcess {
  return { stdout: "", stderr: "", code: 0, ...overrides };
}

const noFile = () => Promise.reject(new Error("result file should not be read"));

describe("resolveBinary", () => {
  it("defaults to the bare command so PATH lookup finds it", () => {
    expect(resolveBinary("claude", {})).toBe("claude");
    expect(resolveBinary("codex", {})).toBe("codex");
    expect(resolveBinary("grok", {})).toBe("grok");
  });

  it("prefers an explicit per-harness override", () => {
    const env = { IT_HARNESS_CLAUDE_BIN: "/Users/m/.local/bin/claude" };
    expect(resolveBinary("claude", env)).toBe("/Users/m/.local/bin/claude");
  });

  it("ignores an empty override rather than spawning the empty string", () => {
    expect(resolveBinary("grok", { IT_HARNESS_GROK_BIN: "" })).toBe("grok");
  });
});

describe("claude adapter", () => {
  it("asks for schema-constrained JSON on stdout", () => {
    const { args } = claudeAdapter.buildInvocation(request(), schemaJson, scratch);
    expect(args).toContain("-p");
    expect(args).toContain("classify this");
    expect(args.join(" ")).toContain("--output-format json");
    expect(args[args.indexOf("--json-schema") + 1]).toBe(schemaJson);
  });

  it("passes the system prompt and model through", () => {
    const { args } = claudeAdapter.buildInvocation(
      request({ systemPrompt: "be terse", model: "sonnet" }),
      schemaJson,
      scratch,
    );
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("be terse");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("withholds filesystem tools unless the step needs to write", () => {
    const ro = claudeAdapter.buildInvocation(request({ access: "read-only" }), schemaJson, scratch);
    expect(ro.args).not.toContain("--dangerously-skip-permissions");
    // Not merely ungranted — actively denied, since -p has these by default.
    expect(ro.args).toContain("--disallowedTools");
    expect(ro.args).toEqual(expect.arrayContaining(["Write", "Edit", "Bash"]));

    const rw = claudeAdapter.buildInvocation(
      request({ access: "write", extraDirs: ["/vault"] }),
      schemaJson,
      scratch,
    );
    expect(rw.args).toContain("--dangerously-skip-permissions");
    expect(rw.args[rw.args.indexOf("--add-dir") + 1]).toBe("/vault");
  });

  it("approves the tools a step names — -p denies an MCP tool nobody allowed, read-only or not", () => {
    const ro = claudeAdapter.buildInvocation(
      request({ access: "read-only", allowTools: ["mcp__serena__*"] }),
      schemaJson,
      scratch,
    );
    expect(ro.args[ro.args.indexOf("--allowedTools") + 1]).toBe("mcp__serena__*");
    // Still denied what a reading step must not have.
    expect(ro.args).toContain("--disallowedTools");

    const rw = claudeAdapter.buildInvocation(
      request({ access: "write", allowTools: ["mcp__serena__*"] }),
      schemaJson,
      scratch,
    );
    const allowed = rw.args.slice(rw.args.indexOf("--allowedTools") + 1, rw.args.indexOf("--dangerously-skip-permissions"));
    expect(allowed).toEqual(expect.arrayContaining(["Read", "Edit", "Bash", "mcp__serena__*"]));

    const none = claudeAdapter.buildInvocation(request({ access: "read-only" }), schemaJson, scratch);
    expect(none.args).not.toContain("--allowedTools");
  });

  it("unwraps the JSON string nested in the result envelope", async () => {
    const stdout = JSON.stringify({ subtype: "success", result: '{"verdict":"ok"}' });
    await expect(claudeAdapter.extractPayload(proc({ stdout }), noFile)).resolves.toEqual({
      verdict: "ok",
    });
  });

  it("accepts an answer the model wrapped in a markdown fence", async () => {
    const stdout = JSON.stringify({ result: '```json\n{"verdict":"ok"}\n```' });
    await expect(claudeAdapter.extractPayload(proc({ stdout }), noFile)).resolves.toEqual({
      verdict: "ok",
    });
  });

  it("surfaces a harness-reported error instead of a parse failure", async () => {
    const stdout = JSON.stringify({ is_error: true, result: "rate limited" });
    await expect(claudeAdapter.extractPayload(proc({ stdout }), noFile)).rejects.toThrow(
      /rate limited/,
    );
  });

  // Frames reach claude as content blocks on stdin. The CLI has no flag for a
  // local image: --file downloads an uploaded resource by id, so the streaming
  // input channel is the only way in.
  it("carries images as base64, since it cannot take a path", () => {
    expect(claudeAdapter.imageEncoding).toBe("base64");
  });

  it("switches to the streaming channel and sends images on stdin", () => {
    const { args, stdin } = claudeAdapter.buildInvocation(
      request({ imagePaths: ["/f/1.jpg"] }),
      schemaJson,
      scratch,
      [{ path: "/f/1.jpg", mediaType: "image/jpeg", base64: "AAAA" }],
    );

    expect(args.join(" ")).toContain("--input-format stream-json");
    // The CLI rejects stream-json input paired with any other output format.
    expect(args.join(" ")).toContain("--output-format stream-json");
    // The prompt moves to stdin, so it must not also ride as a positional.
    expect(args).not.toContain("classify this");
    expect(args[args.indexOf("--json-schema") + 1]).toBe(schemaJson);

    const message = JSON.parse(stdin!.trim()) as {
      message: { content: { type: string; text?: string; source?: { data: string } }[] };
    };
    expect(message.message.content[0]).toEqual({ type: "text", text: "classify this" });
    expect(message.message.content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    });
  });

  it("leaves the single-envelope channel alone when there are no images", () => {
    const { args, stdin } = claudeAdapter.buildInvocation(request(), schemaJson, scratch);
    expect(args.join(" ")).toContain("--output-format json");
    expect(args).toContain("classify this");
    expect(stdin).toBeUndefined();
  });

  // On the streaming channel stdout is JSONL, so the envelope the other tests
  // parse whole arrives as one line among many.
  it("reads the answer from the result line of a streamed run", async () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      JSON.stringify({ type: "result", subtype: "success", result: '{"verdict":"ok"}' }),
    ].join("\n");
    await expect(claudeAdapter.extractPayload(proc({ stdout }), noFile)).resolves.toEqual({
      verdict: "ok",
    });
  });

  it("finds the result line despite a trailing newline", async () => {
    const stdout = `${JSON.stringify({ type: "system" })}\n`
      + `${JSON.stringify({ type: "result", result: '{"verdict":"ok"}' })}\n`;
    await expect(claudeAdapter.extractPayload(proc({ stdout }), noFile)).resolves.toEqual({
      verdict: "ok",
    });
  });

  // Escaped newlines inside a string value are two characters, not a line
  // break, so splitting on newlines must not be fooled by prose in the output.
  it("is not confused by newlines inside a streamed string value", async () => {
    const stdout = [
      JSON.stringify({ type: "assistant", text: "line one\nline two" }),
      JSON.stringify({ type: "result", result: '{"verdict":"ok"}' }),
    ].join("\n");
    await expect(claudeAdapter.extractPayload(proc({ stdout }), noFile)).resolves.toEqual({
      verdict: "ok",
    });
  });

  // A stream cut off mid-run has events but no summary. Saying so beats
  // reporting the init line as malformed JSON.
  it("reports a streamed run that ended before producing a result", async () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [] } }),
    ].join("\n");
    await expect(claudeAdapter.extractPayload(proc({ stdout }), noFile)).rejects.toThrow(
      /never reported a result|ended before/i,
    );
  });

  it("reports no usage when a streamed run never produced a result", () => {
    const stdout = JSON.stringify({ type: "system", subtype: "init" });
    expect(claudeAdapter.extractUsage?.(proc({ stdout }))).toBeUndefined();
  });

  it("reports usage from the result line of a streamed run", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "result",
        result: "{}",
        total_cost_usd: 0.55,
        usage: { input_tokens: 2, output_tokens: 743, cache_creation_input_tokens: 53654 },
        modelUsage: { "claude-opus-5": {} },
      }),
    ].join("\n");
    expect(claudeAdapter.extractUsage?.(proc({ stdout }))).toMatchObject({
      model: "claude-opus-5",
      outputTokens: 743,
      costUsd: 0.55,
    });
  });
  it("names the effort level in claude's own flag", () => {
    const { args } = claudeAdapter.buildInvocation(
      request({ effort: "xhigh" }),
      schemaJson,
      scratch,
    );
    expect(args[args.indexOf("--effort") + 1]).toBe("xhigh");
  });

  it("passes no effort flag when the caller named no level", () => {
    const { args } = claudeAdapter.buildInvocation(request(), schemaJson, scratch);
    expect(args).not.toContain("--effort");
  });
});

describe("codex adapter", () => {
  it("routes the schema and the answer through files", () => {
    const { args } = codexAdapter.buildInvocation(request(), schemaJson, scratch);
    expect(args[0]).toBe("exec");
    expect(args[args.indexOf("--output-schema") + 1]).toBe(scratch.schemaPath);
    expect(args[args.indexOf("-o") + 1]).toBe(scratch.resultPath);
    expect(args).toContain("--skip-git-repo-check");
  });

  it("declares that the schema must be written to disk first", () => {
    expect(codexAdapter.schemaOnDisk).toBe(true);
    expect(claudeAdapter.schemaOnDisk).toBe(false);
    expect(grokAdapter.schemaOnDisk).toBe(false);
  });

  it("widens the sandbox only for write steps", () => {
    const ro = codexAdapter.buildInvocation(request({ access: "read-only" }), schemaJson, scratch);
    expect(ro.args[ro.args.indexOf("--sandbox") + 1]).toBe("read-only");

    const rw = codexAdapter.buildInvocation(request({ access: "write" }), schemaJson, scratch);
    expect(rw.args[rw.args.indexOf("--sandbox") + 1]).toBe("danger-full-access");
  });

  it("reads the answer from the file, ignoring banner noise on stdout", async () => {
    const stdout = "OpenAI Codex v0.145.0\nhook: SessionStart\n{ not json }";
    const payload = await codexAdapter.extractPayload(
      proc({ stdout }),
      async () => '{"verdict":"ok"}',
    );
    expect(payload).toEqual({ verdict: "ok" });
  });

  // Alone among the three, codex reads the files itself, so frames cost nothing
  // to pass and no size ceiling applies.
  it("takes image paths rather than their bytes", () => {
    expect(codexAdapter.imageEncoding).toBe("path");
  });

  it("attaches image paths and moves the prompt to stdin", () => {
    const { args, stdin } = codexAdapter.buildInvocation(
      request({ imagePaths: ["/f/1.jpg", "/f/2.jpg"] }),
      schemaJson,
      scratch,
      [
        { path: "/f/1.jpg", mediaType: "image/jpeg" },
        { path: "/f/2.jpg", mediaType: "image/jpeg" },
      ],
    );

    const i = args.indexOf("-i");
    expect(args.slice(i + 1, i + 3)).toEqual(["/f/1.jpg", "/f/2.jpg"]);
    // -i is variadic, so a trailing positional prompt would be swallowed as a
    // filename. It has to arrive on stdin instead.
    expect(args).not.toContain("classify this");
    expect(stdin).toBe("classify this");
  });

  it("keeps the prompt positional when no images are attached", () => {
    const { args, stdin } = codexAdapter.buildInvocation(request(), schemaJson, scratch);
    expect(args).toContain("classify this");
    expect(stdin).toBeUndefined();
  });
  it("carries effort as a config override, the only way codex takes one", () => {
    const { args } = codexAdapter.buildInvocation(request({ effort: "high" }), schemaJson, scratch);
    expect(args[args.indexOf("-c") + 1]).toBe("model_reasoning_effort=high");
  });

  it("clamps a level the named model does not offer down to one it does", () => {
    // luna stops at `max` where sol reaches `ultra`, so the same request
    // resolves differently depending on which model the call names.
    const luna = codexAdapter.buildInvocation(
      request({ effort: "ultra", model: "gpt-5.6-luna" }),
      schemaJson,
      scratch,
    );
    const sol = codexAdapter.buildInvocation(
      request({ effort: "ultra", model: "gpt-5.6-sol" }),
      schemaJson,
      scratch,
    );

    expect(luna.args[luna.args.indexOf("-c") + 1]).toBe("model_reasoning_effort=max");
    expect(sol.args[sol.args.indexOf("-c") + 1]).toBe("model_reasoning_effort=ultra");
  });

  it("assumes the narrowest ladder when the call names no model at all", () => {
    const { args } = codexAdapter.buildInvocation(request({ effort: "ultra" }), schemaJson, scratch);
    expect(args[args.indexOf("-c") + 1]).toBe("model_reasoning_effort=xhigh");
  });
});

describe("grok adapter", () => {
  it("requests structured output inline", () => {
    const { args } = grokAdapter.buildInvocation(request(), schemaJson, scratch);
    expect(args[args.indexOf("-p") + 1]).toBe("classify this");
    expect(args[args.indexOf("--json-schema") + 1]).toBe(schemaJson);
  });

  it("denies the write tools on a read-only step", () => {
    const ro = grokAdapter.buildInvocation(request({ access: "read-only" }), schemaJson, scratch);
    expect(ro.args[ro.args.indexOf("--disallowed-tools") + 1]).toBe("Write,Edit,Bash");

    const rw = grokAdapter.buildInvocation(request({ access: "write" }), schemaJson, scratch);
    expect(rw.args).not.toContain("--disallowed-tools");
    expect(rw.args).toContain("--always-approve");
  });

  it("reads the pre-parsed structuredOutput field", async () => {
    const stdout = JSON.stringify({
      text: '{"verdict":"ok"}',
      structuredOutput: { verdict: "ok" },
    });
    await expect(grokAdapter.extractPayload(proc({ stdout }), noFile)).resolves.toEqual({
      verdict: "ok",
    });
  });

  it("falls back to the text field when structuredOutput is absent", async () => {
    const stdout = JSON.stringify({ text: '{"verdict":"ok"}' });
    await expect(grokAdapter.extractPayload(proc({ stdout }), noFile)).resolves.toEqual({
      verdict: "ok",
    });
  });

  // Grok's own --prompt-json would carry the bytes on argv, and ARG_MAX is a
  // hard 1 MiB kernel limit — real frames run ten to forty times over it even
  // after downscaling. So grok is pointed at the files and opens them itself.
  it("takes image paths, since carrying bytes on argv would overrun ARG_MAX", () => {
    expect(grokAdapter.imageEncoding).toBe("path");
  });

  it("names the image files in the prompt for the model to open", () => {
    const { args } = grokAdapter.buildInvocation(
      request({ imagePaths: ["/f/1.jpg", "/f/2.jpg"] }),
      schemaJson,
      scratch,
      [
        { path: "/f/1.jpg", mediaType: "image/jpeg" },
        { path: "/f/2.jpg", mediaType: "image/jpeg" },
      ],
    );

    const prompt = args[args.indexOf("-p") + 1];
    expect(prompt).toContain("classify this");
    expect(prompt).toContain("/f/1.jpg");
    expect(prompt).toContain("/f/2.jpg");
  });

  it("leaves the prompt alone when there are no images", () => {
    const { args } = grokAdapter.buildInvocation(request(), schemaJson, scratch);
    expect(args[args.indexOf("-p") + 1]).toBe("classify this");
  });

  // Reading is how the frames arrive, so it must survive the read-only denylist.
  it("keeps the read tools available on a read-only step", () => {
    const { args } = grokAdapter.buildInvocation(request({ access: "read-only" }), schemaJson, scratch);
    expect(args[args.indexOf("--disallowed-tools") + 1]).not.toMatch(/\bRead\b/);
  });

  it("names the effort level in grok's own flag", () => {
    const { args } = grokAdapter.buildInvocation(request({ effort: "medium" }), schemaJson, scratch);
    expect(args[args.indexOf("--reasoning-effort") + 1]).toBe("medium");
  });

});

describe("registry", () => {
  it("resolves every declared harness to an adapter that owns its name", () => {
    for (const name of HARNESS_NAMES) {
      expect(getAdapter(name).name).toBe(name);
    }
  });

  it("rejects an unknown harness by name", () => {
    expect(() => getAdapter("gemini" as never)).toThrow(/gemini/);
  });
});
