# it-ts-sdk

Shared TypeScript infrastructure for worm projects: a pnpm workspace of three
packages that version and publish independently.

| Package | What it holds |
|---|---|
| [`@itfrombit/harness`](packages/harness) | Headless agent-CLI runner — spawns `claude`/`codex`/`grok` detached, validates their output against a zod schema, retries transient failures, checks pinned models against an allowlist |
| [`@itfrombit/obsidian`](packages/obsidian) | Vault-path resolution, read from Obsidian's own registry file, platform-aware across macOS and Linux |
| [`@itfrombit/graph`](packages/graph) | Graph-node middleware — execution tracing and the `required` state-channel guard |

Each has its own README with the API and the reasoning behind it.

## Local development

Node 20 or newer. Everything runs from the repository root.

```bash
git clone git@github.com:macku99/it-ts-sdk.git
cd it-ts-sdk
corepack enable && pnpm install
```

The package manager is pinned in `package.json`'s `packageManager` field, so
`corepack enable` provisions the right pnpm without installing one globally.

`pnpm install` also builds. Each package has a `prepare` script running `tsc`,
so `dist/` and its type declarations exist as soon as the install finishes —
there is no separate build step to forget before a consumer can resolve the
packages.

```bash
pnpm run lint                          # oxlint
pnpm test                              # all three suites
pnpm run typecheck                     # source and tests, in one pass
pnpm run build                         # each package to its own dist/
```

Narrower runs, for when you are working on one thing:

```bash
pnpm test --filter @itfrombit/harness  # one package's suite
pnpm exec vitest run packages/obsidian # same, by path
pnpm exec vitest run -t "allowlist"    # by test name, across the workspace
pnpm run build --filter @itfrombit/graph
```

`pnpm-workspace.yaml` names the packages and carries the build-script
approvals. pnpm refuses to run a dependency's install scripts unless it is
listed there — esbuild, which vitest uses, is the one exception.

### How the workspace is laid out

```
packages/<name>/
  src/            the package; relative imports carry a .js suffix
  tests/          its suite, importing ../src/… — not the built output
  package.json    name, exports, and its own version
  tsconfig.json   extends ../../tsconfig.base.json
vitest.config.ts    one runner for every package's tests
tsconfig.json       typechecks src and tests together
pnpm-workspace.yaml the package list and the build-script approvals
.oxlintrc.json      the lint rules, and why three are off
```

Tests live beside the package they cover but run from the root, so `pnpm test`
reaches all of them. A package whose tests only ever ran from its own directory
is a package the workspace stops checking.

Tests import `../src/…` rather than `dist/`, which is why the suite catches a
change before the build does.

### Working on the SDK and a consumer together

A consumer can depend on a package by path instead of by version:

```json
"dependencies": {
  "@itfrombit/harness": "file:../../it-ts-sdk/packages/harness"
}
```

pnpm symlinks a `file:` directory dependency through its store, and the link
resolves to this working copy — so an edit here shows up in the consumer with no
reinstall and no publish. Clone both repositories side by side
and install this one first — each package's runtime dependencies hoist to this
workspace's `node_modules`, and the symlink resolves through the package's real
path, so a consumer installed against an uninstalled SDK fails at import with a
missing dependency that reads like a broken port rather than a missing step.

[`it-tubeworm`](https://github.com/macku99/it-tubeworm) consumes the packages
this way on purpose: both repositories are moving quickly, and a published
version would mean a publish-and-bump cycle for every change.

## Consuming from anywhere else

```bash
npm install @itfrombit/harness
```

The packages are public on npm even though this repository is private. Nothing
in them reads a credential or a vault's contents.

## Releasing

Versions are per package — there is no repository-wide release. Bump the version
in the package you changed and merge to `main`; `.github/workflows/publish.yml`
publishes whatever the registry does not already have and leaves the rest alone.
Adding a version to two packages in one commit publishes both.

Publishing authenticates by OIDC through npm's trusted publishing, so there is
no token stored in this repository. It has no `--provenance`: npm stopped
supporting provenance from private source repositories, so the flag would fail
rather than add anything.

`pnpm publish -r --dry-run` from the root prints exactly what each tarball would
contain, without publishing. Worth reading before a first release of anything —
a published version can never be replaced or reused.

## CI

`.github/workflows/ci.yml` runs oxlint, the typecheck, the suite and the build on
every push and pull request — the build last because `files` publishes `dist/`
and a build that fails is a package that would publish empty. `publish.yml` runs
all four again inside the publish job rather than trusting that tick, because a
published version cannot be taken back.

oxlint is configured in `.oxlintrc.json` at `correctness` and `suspicious`.
Three rules are off with the reasoning recorded there: the two that flag
`sort()` and `reverse()` on arrays the expression just created, and one
function-scoping preference.
