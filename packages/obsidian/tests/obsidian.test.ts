import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  resolveVaultPath,
  obsidianConfigPath,
  missingRegistryMessage,
  buildNotePath,
  noteExists,
  findNoteBySourceUrl,
  sanitizeChannelName,
} from "../src/index.js";

function tmpDir() {
  return join(tmpdir(), `obsidian-test-${randomUUID()}`);
}

describe("obsidianConfigPath", () => {
  it("reads Obsidian's own registry under Application Support on macOS", () => {
    expect(obsidianConfigPath("darwin", {}, "/Users/m")).toBe(
      "/Users/m/Library/Application Support/obsidian/obsidian.json",
    );
  });

  it("reads it under ~/.config elsewhere", () => {
    expect(obsidianConfigPath("linux", {}, "/home/m")).toBe(
      "/home/m/.config/obsidian/obsidian.json",
    );
  });

  it("honors XDG_CONFIG_HOME", () => {
    expect(obsidianConfigPath("linux", { XDG_CONFIG_HOME: "/home/m/cfg" }, "/home/m")).toBe(
      "/home/m/cfg/obsidian/obsidian.json",
    );
  });

  it("expands a tilde in XDG_CONFIG_HOME", () => {
    expect(obsidianConfigPath("linux", { XDG_CONFIG_HOME: "~/cfg" })).toContain(
      "/cfg/obsidian/obsidian.json",
    );
  });

  // The whole point of taking a home is that a test can name one. Expanding the
  // tilde against the real homedir instead would make every assertion here pass
  // on the author's machine and describe nothing.
  it("expands that tilde against the home it was given, not the machine's", () => {
    expect(obsidianConfigPath("linux", { XDG_CONFIG_HOME: "~/cfg" }, "/home/m")).toBe(
      "/home/m/cfg/obsidian/obsidian.json",
    );
  });

  it("ignores a blank XDG_CONFIG_HOME rather than resolving beside the cwd", () => {
    expect(obsidianConfigPath("linux", { XDG_CONFIG_HOME: "  " }, "/home/m")).toBe(
      "/home/m/.config/obsidian/obsidian.json",
    );
  });
});

describe("missingRegistryMessage", () => {
  it("names the file that was looked for", () => {
    expect(missingRegistryMessage("/home/m/.config/obsidian/obsidian.json", "linux")).toContain(
      "/home/m/.config/obsidian/obsidian.json",
    );
  });

  it("points at the Flatpak location on Linux, where Obsidian is installed both ways", () => {
    expect(missingRegistryMessage("/home/m/.config/obsidian/obsidian.json", "linux")).toContain(
      ".var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json",
    );
  });

  it("says nothing about Flatpak on macOS", () => {
    expect(missingRegistryMessage("/Users/m/Library/x/obsidian.json", "darwin")).not.toContain(
      "Flatpak",
    );
  });
});

describe("resolveVaultPath", () => {
  let configDir: string;
  let configPath: string;

  beforeEach(async () => {
    configDir = tmpDir();
    await mkdir(configDir, { recursive: true });
    configPath = join(configDir, "obsidian.json");
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("resolves vault by folder name", async () => {
    const config = {
      vaults: {
        abc123: { path: "/Users/test/Documents/Obsidian/myvault", ts: 1000 },
        def456: { path: "/Users/test/Documents/Obsidian/other", ts: 2000 },
      },
    };
    await writeFile(configPath, JSON.stringify(config));

    const result = await resolveVaultPath("myvault", configPath);
    expect(result).toBe("/Users/test/Documents/Obsidian/myvault");
  });

  it("resolves the correct vault when multiple exist", async () => {
    const config = {
      vaults: {
        a: { path: "/vaults/alpha" },
        b: { path: "/vaults/beta" },
        c: { path: "/vaults/gamma" },
      },
    };
    await writeFile(configPath, JSON.stringify(config));

    const result = await resolveVaultPath("beta", configPath);
    expect(result).toBe("/vaults/beta");
  });

  it("throws when vault name not found", async () => {
    const config = {
      vaults: {
        abc123: { path: "/Users/test/Documents/Obsidian/myvault" },
      },
    };
    await writeFile(configPath, JSON.stringify(config));

    await expect(resolveVaultPath("nonexistent", configPath)).rejects.toThrow(
      'Obsidian vault "nonexistent" not found',
    );
  });

  it("names the registry it looked for when there is none", async () => {
    const missing = join(configDir, "nope.json");
    await expect(resolveVaultPath("anything", missing)).rejects.toThrow(missing);
  });

  it("throws on invalid JSON", async () => {
    await writeFile(configPath, "not json");
    await expect(resolveVaultPath("anything", configPath)).rejects.toThrow();
  });
});

describe("buildNotePath", () => {
  it("builds correct path with all components", () => {
    const result = buildNotePath(
      "/vaults/myvault",
      "500. Tubeworm",
      "techchannel",
      "2026-04-06",
      "how-to-build-saas",
    );
    expect(result).toBe(
      "/vaults/myvault/500. Tubeworm/techchannel/2026-04-06-how-to-build-saas.md",
    );
  });

  it("works with custom folder names", () => {
    const result = buildNotePath("/vault", "Ingested Videos", "chan", "2026-01-01", "test");
    expect(result).toBe("/vault/Ingested Videos/chan/2026-01-01-test.md");
  });
});

describe("noteExists", () => {
  let dir: string;

  beforeEach(async () => {
    dir = tmpDir();
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns true for existing file", async () => {
    const path = join(dir, "note.md");
    await writeFile(path, "# Note");
    expect(await noteExists(path)).toBe(true);
  });

  it("returns false for non-existing file", async () => {
    expect(await noteExists(join(dir, "nope.md"))).toBe(false);
  });
});

describe("findNoteBySourceUrl", () => {
  let vaultDir: string;

  beforeEach(async () => {
    vaultDir = tmpDir();
    await mkdir(vaultDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("finds note with matching source URL in frontmatter", async () => {
    const channelDir = join(vaultDir, "channel1");
    await mkdir(channelDir, { recursive: true });
    const notePath = join(channelDir, "2026-04-06-test.md");
    await writeFile(
      notePath,
      `---\ntitle: Test\nsource: https://youtube.com/watch?v=abc123\n---\n\n# Content`,
    );

    const result = await findNoteBySourceUrl(vaultDir, "https://youtube.com/watch?v=abc123");
    expect(result).toBe(notePath);
  });

  it("finds note with quoted source URL", async () => {
    const channelDir = join(vaultDir, "SomeChannel");
    await mkdir(channelDir, { recursive: true });
    const notePath = join(channelDir, "note.md");
    await writeFile(
      notePath,
      `---\ntitle: Test\nsource: "https://youtu.be/xyz789"\n---\n\nContent`,
    );

    const result = await findNoteBySourceUrl(vaultDir, "https://youtu.be/xyz789");
    expect(result).toBe(notePath);
  });

  it("returns undefined when no matching note exists", async () => {
    const channelDir = join(vaultDir, "channel1");
    await mkdir(channelDir, { recursive: true });
    await writeFile(
      join(channelDir, "other.md"),
      `---\ntitle: Other\nsource: https://youtube.com/watch?v=different\n---\n\nContent`,
    );

    const result = await findNoteBySourceUrl(vaultDir, "https://youtube.com/watch?v=abc123");
    expect(result).toBeUndefined();
  });

  it("returns undefined when search directory doesn't exist", async () => {
    const result = await findNoteBySourceUrl(
      join(vaultDir, "nonexistent"),
      "https://youtube.com/watch?v=abc123",
    );
    expect(result).toBeUndefined();
  });

  it("searches nested subdirectories recursively", async () => {
    const nestedDir = join(vaultDir, "subchannel", "deep");
    await mkdir(nestedDir, { recursive: true });
    const notePath = join(nestedDir, "deep-note.md");
    await writeFile(notePath, `---\nsource: https://youtu.be/nested\n---\n\nDeep content`);

    const result = await findNoteBySourceUrl(vaultDir, "https://youtu.be/nested");
    expect(result).toBe(notePath);
  });

  it("ignores non-markdown files", async () => {
    await writeFile(
      join(vaultDir, "data.json"),
      `{"source": "https://youtube.com/watch?v=abc123"}`,
    );

    const result = await findNoteBySourceUrl(vaultDir, "https://youtube.com/watch?v=abc123");
    expect(result).toBeUndefined();
  });

  it("ignores markdown files without frontmatter", async () => {
    await writeFile(
      join(vaultDir, "no-frontmatter.md"),
      `# Just a note\n\nsource: https://youtube.com/watch?v=abc123`,
    );

    const result = await findNoteBySourceUrl(vaultDir, "https://youtube.com/watch?v=abc123");
    expect(result).toBeUndefined();
  });

  it("skips _moc/ directory even when a note inside has matching source", async () => {
    const mocDir = join(vaultDir, "_moc");
    await mkdir(mocDir, { recursive: true });
    await writeFile(
      join(mocDir, "agentic-architecture.md"),
      `---\nsource: https://youtu.be/trap\n---\n\n# MOC`,
    );

    const result = await findNoteBySourceUrl(vaultDir, "https://youtu.be/trap");
    expect(result).toBeUndefined();
  });

  it("skips _daily/ directory", async () => {
    const dailyDir = join(vaultDir, "_daily");
    await mkdir(dailyDir, { recursive: true });
    await writeFile(
      join(dailyDir, "2026-05-03.md"),
      `---\nsource: https://youtu.be/daily\n---\n\n# Daily`,
    );

    const result = await findNoteBySourceUrl(vaultDir, "https://youtu.be/daily");
    expect(result).toBeUndefined();
  });

  it("skips .obsidian/ directory", async () => {
    const obsDir = join(vaultDir, ".obsidian");
    await mkdir(obsDir, { recursive: true });
    await writeFile(join(obsDir, "config.md"), `---\nsource: https://youtu.be/obs\n---`);

    const result = await findNoteBySourceUrl(vaultDir, "https://youtu.be/obs");
    expect(result).toBeUndefined();
  });

  it("skips .trash/ directory", async () => {
    const trashDir = join(vaultDir, ".trash");
    await mkdir(trashDir, { recursive: true });
    await writeFile(join(trashDir, "old.md"), `---\nsource: https://youtu.be/trash\n---`);

    const result = await findNoteBySourceUrl(vaultDir, "https://youtu.be/trash");
    expect(result).toBeUndefined();
  });

  it("skips files named _index.md at any depth", async () => {
    const channelDir = join(vaultDir, "ChannelName");
    await mkdir(channelDir, { recursive: true });
    await writeFile(join(channelDir, "_index.md"), `---\nsource: https://youtu.be/index\n---`);

    const result = await findNoteBySourceUrl(vaultDir, "https://youtu.be/index");
    expect(result).toBeUndefined();
  });

  it("still finds notes in deeply nested channel folders alongside excluded dirs", async () => {
    const mocDir = join(vaultDir, "_moc");
    await mkdir(mocDir, { recursive: true });
    await writeFile(join(mocDir, "irrelevant.md"), `---\nsource: https://youtu.be/wrong\n---`);

    const channelDir = join(vaultDir, "Real Channel");
    await mkdir(channelDir, { recursive: true });
    const notePath = join(channelDir, "2026-05-03-real.md");
    await writeFile(notePath, `---\nsource: https://youtu.be/real\n---\n\nContent`);

    const result = await findNoteBySourceUrl(vaultDir, "https://youtu.be/real");
    expect(result).toBe(notePath);
  });
});

describe("sanitizeChannelName", () => {
  it("replaces forward slash with dash", () => {
    expect(sanitizeChannelName("Tech / News")).toBe("Tech - News");
  });

  it("replaces backslash with dash", () => {
    expect(sanitizeChannelName("Tech \\ News")).toBe("Tech - News");
  });

  it("replaces colon with dash", () => {
    expect(sanitizeChannelName("Tech: News")).toBe("Tech- News");
  });

  it("replaces asterisk with dash", () => {
    expect(sanitizeChannelName("Tech * News")).toBe("Tech - News");
  });

  it("replaces question mark with dash", () => {
    expect(sanitizeChannelName("Tech ? News")).toBe("Tech - News");
  });

  it("replaces double quote with dash", () => {
    expect(sanitizeChannelName('Tech "News"')).toBe("Tech -News-");
  });

  it("replaces angle brackets with dash", () => {
    expect(sanitizeChannelName("Tech <News>")).toBe("Tech -News-");
  });

  it("replaces pipe with dash", () => {
    expect(sanitizeChannelName("Tech | News")).toBe("Tech - News");
  });

  it("preserves @ symbol", () => {
    expect(sanitizeChannelName("@username")).toBe("@username");
  });

  it("collapses multiple whitespace to single space", () => {
    expect(sanitizeChannelName("Tech    News")).toBe("Tech News");
  });

  it("collapses tabs and newlines", () => {
    expect(sanitizeChannelName("Tech\t\n\t News")).toBe("Tech News");
  });

  it("trims leading whitespace", () => {
    expect(sanitizeChannelName("  Tech News")).toBe("Tech News");
  });

  it("trims trailing whitespace", () => {
    expect(sanitizeChannelName("Tech News  ")).toBe("Tech News");
  });

  it("trims leading dots", () => {
    expect(sanitizeChannelName("...Tech News")).toBe("Tech News");
  });

  it("trims trailing dots", () => {
    expect(sanitizeChannelName("Tech News...")).toBe("Tech News");
  });

  it("preserves Unicode characters", () => {
    expect(sanitizeChannelName("Tech 新聞 News")).toBe("Tech 新聞 News");
  });

  it("preserves casing", () => {
    expect(sanitizeChannelName("TeCh NeWs")).toBe("TeCh NeWs");
  });

  it("handles complex combination of replacements", () => {
    expect(sanitizeChannelName('  ...Tech / "News" | Update...  ')).toBe("Tech - -News- - Update");
  });
});
