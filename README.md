# it-core-ts-sdk

Shared TypeScript infrastructure for worm projects, as an npm workspace of
independently versioned packages.

| Package | What it holds |
|---|---|
| `@it-core/harness` | Headless agent-CLI runner — spawns `claude`/`codex`/`grok` detached, validates their output against a zod schema, retries transient failures, checks pinned models against an allowlist |
| `@it-core/obsidian` | Vault-path resolution, read from Obsidian's own registry file, platform-aware across macOS and Linux |
| `@it-core/graph` | Graph-node middleware — execution tracing and the `required` state-channel guard |

## Working in the repo

```bash
npm install      # once, at the root — the workspace hoists shared deps here
npm test         # every package's suite
npm run build    # each package to its own dist/, with type declarations
npm run typecheck
```

## Consuming from a worm repository

Clone this repo as a sibling of the consuming one and depend on the packages by
path:

```json
"dependencies": {
  "@it-core/harness": "file:../../it-core-ts-sdk/packages/harness"
}
```

npm symlinks a `file:` directory dependency, so an edit here is visible in the
consumer immediately with no reinstall.

Two ordering requirements come with that. **Install this workspace first**: each
package's runtime dependencies hoist to the workspace root's `node_modules`, and
the symlink resolves through the package's real path — so a consumer installed
against an uninstalled SDK fails at import with a missing dependency, which
reads like a broken port rather than a missing step. And **build before
consuming**: the packages publish `dist/`, so a consumer that skips `npm run
build` resolves the `exports` entry to a file that is not there yet.
