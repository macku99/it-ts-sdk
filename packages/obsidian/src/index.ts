import { readFile, access, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { expandHome } from "./paths.js";

// Re-exported because a consumer resolving a vault path from the environment
// needs the same tilde expansion this module applies to the registry path, and
// two copies of it would drift.
export { expandHome };

/** Where Obsidian keeps the registry of vaults it knows about, per platform. */
export function obsidianConfigPath(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "obsidian", "obsidian.json");
  }
  // Electron's userData directory. A blank XDG_CONFIG_HOME is no value: joining
  // through "" would resolve the registry beside the working directory.
  const configHome = env.XDG_CONFIG_HOME?.trim();
  const base = configHome ? expandHome(configHome, home) : join(home, ".config");
  return join(base, "obsidian", "obsidian.json");
}

/**
 * Obsidian ships on Linux as a native package and as a Flatpak, and only the
 * native one writes the registry where `obsidianConfigPath` looks. Naming the
 * other location turns "no such file" into something actionable.
 */
export function missingRegistryMessage(path: string, platform: string = process.platform): string {
  const flatpak =
    platform === "darwin"
      ? ""
      : " A Flatpak install keeps it at"
        + " ~/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json instead.";
  return `No Obsidian vault registry at ${path} — is Obsidian installed here?${flatpak}`;
}

const OBSIDIAN_CONFIG_PATH = obsidianConfigPath();

interface ObsidianVaultEntry {
  path: string;
  ts?: number;
  open?: boolean;
}

interface ObsidianConfig {
  vaults: Record<string, ObsidianVaultEntry>;
}

async function readRegistry(configPath: string): Promise<ObsidianConfig> {
  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(missingRegistryMessage(configPath), { cause: err });
    }
    throw err;
  }
  return JSON.parse(content) as ObsidianConfig;
}

export async function resolveVaultPath(
  vaultName: string,
  configPath: string = OBSIDIAN_CONFIG_PATH,
): Promise<string> {
  const config = await readRegistry(configPath);

  for (const entry of Object.values(config.vaults)) {
    if (basename(entry.path) === vaultName) {
      return entry.path;
    }
  }

  throw new Error(`Obsidian vault "${vaultName}" not found`);
}

/** A vault as the registry claims it, paired with what is actually on disk. */
export interface RegisteredVault {
  name: string;
  path: string;
  exists: boolean;
  /** The directory carries a `.obsidian/` config dir, so Obsidian owns it. */
  isVault: boolean;
}

/**
 * Every vault in the registry, name-sorted, each checked against the disk.
 *
 * A registry entry outlives the directory it points at, and a stale one can
 * name a path that still exists without being a vault — which is how a phantom
 * sibling gets mistaken for the real thing. Callers get both facts and decide
 * whether to reject; nothing is filtered out here, because an entry silently
 * dropped is an entry nobody can fix.
 */
export async function listVaults(
  configPath: string = OBSIDIAN_CONFIG_PATH,
): Promise<RegisteredVault[]> {
  const config = await readRegistry(configPath);

  const vaults = await Promise.all(
    Object.values(config.vaults).map(async (entry) => ({
      name: basename(entry.path),
      path: entry.path,
      exists: await noteExists(entry.path),
      isVault: await noteExists(join(entry.path, ".obsidian")),
    })),
  );

  return vaults.toSorted((a, b) => a.name.localeCompare(b.name));
}

export function buildNotePath(
  vault: string,
  folder: string,
  channel: string,
  date: string,
  slug: string,
): string {
  return join(vault, folder, channel, `${date}-${slug}.md`);
}

export async function noteExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findNoteBySourceUrl(
  searchDir: string,
  sourceUrl: string,
): Promise<string | undefined> {
  return searchDirForSourceUrl(searchDir, sourceUrl);
}

// vault-reindex-managed and Obsidian-internal directories that never contain
// agent-written notes. Hard-coded because these are universal vault primitives.
const EXCLUDED_DIRS = new Set([".obsidian", ".trash", "_moc", "_daily"]);
const EXCLUDED_FILES = new Set(["_index.md"]);

async function searchDirForSourceUrl(dir: string, sourceUrl: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[obsidian] Error reading directory:", dir, err);
    }
    return undefined;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const found = await searchDirForSourceUrl(join(dir, entry.name), sourceUrl);
      if (found) return found;
    } else if (entry.name.endsWith(".md") && !EXCLUDED_FILES.has(entry.name)) {
      const fullPath = join(dir, entry.name);
      const content = await readFile(fullPath, "utf-8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        if (
          frontmatter.includes(`source: ${sourceUrl}`)
          || frontmatter.includes(`source: "${sourceUrl}"`)
          || frontmatter.includes(`source: '${sourceUrl}'`)
        ) {
          return fullPath;
        }
      }
    }
  }
  return undefined;
}

export function sanitizeChannelName(name: string): string {
  // Replace reserved filesystem characters with dash
  const reserved = /[/\\:*?"<>|]/g;
  let sanitized = name.replace(reserved, "-");
  // Collapse runs of whitespace to single space
  sanitized = sanitized.replace(/\s+/g, " ");
  // Trim leading/trailing whitespace and dots
  sanitized = sanitized.replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
  return sanitized;
}
