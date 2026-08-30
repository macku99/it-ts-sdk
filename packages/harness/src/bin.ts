import type { HarnessName } from "./types.js";

// Each CLI is invoked by bare name so Node resolves it through PATH. The
// interactive shell shadows all three with wrapper functions, but those are
// invisible to spawn() — it finds the real binaries. The override exists for
// environments with a leaner PATH than a login shell, notably the launchd
// daemon, where ~/.local/bin may be absent.
export function resolveBinary(
  name: HarnessName,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[`IT_HARNESS_${name.toUpperCase()}_BIN`];
  return override && override.length > 0 ? override : name;
}
