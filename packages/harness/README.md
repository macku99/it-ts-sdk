# @itfrombit/harness

Runs `claude`, `codex` and `grok` as headless steps and gets a typed object
back. One adapter covers all three, because all three take a JSON Schema and
constrain their output to it.

```bash
npm install @itfrombit/harness
```

```ts
import { runHarness } from "@itfrombit/harness";
import { z } from "zod";

const review = await runHarness("claude", {
  prompt: "Classify this changelog entry.",
  schema: z.object({ kind: z.enum(["feature", "fix"]), summary: z.string() }),
  access: "read-only",
});
```

## What it handles

Spawning is detached and killed by process group, because coding CLIs start
grandchildren that inherit the output pipes — killing the direct child alone
leaves the promise unsettled past the timeout it exists to enforce. Runs settle
on `close` when it comes promptly and on a bounded drain after `exit` otherwise,
so output is complete in the normal case and bounded always.

Transient failures retry three times with backoff; a schema violation does not,
because the second attempt fails identically. Output is validated against the
zod schema you passed, with zod's `$schema` annotation stripped — Claude Code's
validator rejects the whole invocation over it and the other two ignore it.

A pinned model is checked against an allowlist before anything runs, so a typo
surfaces immediately rather than minutes into a paid pipeline. The check is a
lookup, not a call. Set `IT_HARNESS_SKIP_MODEL_CHECK=1` for a model newer than
the list; there is no silent fallback to a different one.

`IT_HARNESS_<NAME>_BIN` overrides where a binary is found.

## API

`runHarness`, `preflightModels`, `resolveEffort`, `modelFor`, `resolveBinary`,
`toHarnessJsonSchema`, `getAdapter`, `isHarnessName`, `HARNESS_NAMES`, and the
`HarnessRunner` / `HarnessRequest` / `HarnessUsage` / `HarnessAdapter` /
`HarnessName` / `HarnessAccess` / `CompletedProcess` / `ModelSelection` /
`ModelProbe` types.

MIT licensed. Part of [it-ts-sdk](https://github.com/macku99/it-ts-sdk).
