import { describe, it, expect } from "vitest";

import { harnessEnv } from "../src/env.js";
import { spawnHarness } from "../src/run.js";

describe("harnessEnv", () => {
  it("keeps what a CLI needs to find itself, its account and the network", () => {
    const env = harnessEnv({
      PATH: "/usr/bin",
      HOME: "/home/me",
      USER: "me",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      XDG_CONFIG_HOME: "/home/me/.config",
      HTTPS_PROXY: "http://proxy",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      CLAUDE_CONFIG_DIR: "/home/me/.claude-work",
      ANTHROPIC_API_KEY: "sk-ant",
      CODEX_HOME: "/home/me/.codex",
      OPENAI_API_KEY: "sk-openai",
      XAI_API_KEY: "xai",
      GROK_HOME: "/home/me/.grok",
    });

    expect(Object.keys(env).sort()).toEqual(
      [
        "ANTHROPIC_API_KEY",
        "CLAUDE_CONFIG_DIR",
        "CODEX_HOME",
        "GROK_HOME",
        "HOME",
        "HTTPS_PROXY",
        "LANG",
        "LC_ALL",
        "OPENAI_API_KEY",
        "PATH",
        "SSL_CERT_FILE",
        "TMPDIR",
        "USER",
        "XAI_API_KEY",
        "XDG_CONFIG_HOME",
      ].sort(),
    );
  });

  it("drops the caller's own secrets", () => {
    const env = harnessEnv({
      PATH: "/usr/bin",
      SLACK_BOT_TOKEN: "xoxb",
      DEEPGRAM_API_KEY: "dg",
      GROWTHDAY_PASSWORD: "pw",
      APP_KEY: "base64:key",
      IT_CODEX_TOKEN: "codex-token",
    });

    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("leaves out variables that are unset", () => {
    expect(Object.keys(harnessEnv({ PATH: "/usr/bin", HOME: undefined }))).toEqual(["PATH"]);
  });
});

describe("spawnHarness environment", () => {
  it("hands the child only the allowlisted environment", async () => {
    process.env.HARNESS_ENV_PROBE_SECRET = "leaked";
    try {
      const proc = await spawnHarness(
        process.execPath,
        ["-e", "process.stdout.write(JSON.stringify(process.env))"],
        { timeoutMs: 10_000 },
      );
      const childEnv = JSON.parse(proc.stdout) as Record<string, string>;
      expect(childEnv.HARNESS_ENV_PROBE_SECRET).toBeUndefined();
      expect(childEnv.PATH).toBe(process.env.PATH);
    } finally {
      delete process.env.HARNESS_ENV_PROBE_SECRET;
    }
  });
});
