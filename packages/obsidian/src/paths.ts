import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expands a leading `~` to the home directory.
 *
 * dotenv stores values verbatim, so a path like `~/Library/...` arrives with a
 * literal tilde — without expansion, fs operations would target a directory
 * actually named `~`. Every code path that reads a path out of the environment
 * goes through here, vault paths included.
 */
export function expandHome(p: string, home: string = homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}
