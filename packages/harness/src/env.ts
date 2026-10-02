// A harness reads text written by strangers — transcripts, captions, titles —
// so whatever it can see, a prompt injection can see too. The caller's own
// secrets (Slack tokens, API keys for other services, app keys) have no
// business in that process, so the child gets an allowlist rather than a copy
// of the caller's environment.

// What any process needs to run at all: find binaries, its home, a temp dir,
// a locale, and a way through a proxy or a private CA.
const EXACT = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "TERM",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  // Linux keyrings are reached over the session bus, and a CLI that keeps its
  // login there cannot authenticate without it.
  "DBUS_SESSION_BUS_ADDRESS",
]);

// Locale and XDG directories, then each CLI's own account and configuration:
// which account it runs as (CLAUDE_CONFIG_DIR, CODEX_HOME) and any API key it
// authenticates with.
const PREFIXES = ["LC_", "XDG_", "CLAUDE_", "ANTHROPIC_", "CODEX_", "OPENAI_", "GROK_", "XAI_"];

export function harnessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (EXACT.has(name) || PREFIXES.some((prefix) => name.startsWith(prefix))) {
      kept[name] = value;
    }
  }
  return kept;
}
