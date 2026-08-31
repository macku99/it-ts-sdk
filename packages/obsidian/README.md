# @itfrombit/obsidian

Finds an Obsidian vault on disk by name, by reading the registry Obsidian keeps
for itself.

```bash
npm install @itfrombit/obsidian
```

```ts
import { resolveVaultPath, listVaults } from "@itfrombit/obsidian";

const path = await resolveVaultPath("codex");
```

## What it handles

The registry lives in different places per platform: under
`Library/Application Support` on macOS, and under `$XDG_CONFIG_HOME` — falling
back to `~/.config` — everywhere else. `obsidianConfigPath` takes the platform,
environment and home directory as arguments so the choice can be tested rather
than assumed, and a blank `XDG_CONFIG_HOME` is treated as unset instead of
resolving the registry beside the working directory.

Obsidian also ships on Linux as a Flatpak, which writes its registry somewhere
else entirely. A missing-registry error names that other location, so "no such
file" becomes something to act on.

`listVaults` returns every registered vault paired with what is actually on
disk — whether the directory exists, and whether it carries a `.obsidian/`
config dir. Nothing is filtered out: a registry entry outlives the directory it
points at, and an entry silently dropped is an entry nobody can fix.

## API

`resolveVaultPath`, `listVaults`, `obsidianConfigPath`, `missingRegistryMessage`,
`buildNotePath`, `noteExists`, `findNoteBySourceUrl`, `sanitizeChannelName`,
`expandHome`, and the `RegisteredVault` type.

MIT licensed. Part of [it-ts-sdk](https://github.com/macku99/it-ts-sdk).
