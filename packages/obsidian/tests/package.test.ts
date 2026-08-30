import { describe, it, expect } from "vitest";

import { PACKAGE_NAME } from "../src/index.js";

// Proves the workspace wiring end to end before any real module lands here:
// the root vitest run reaches this package, TypeScript resolves its source
// through the same .js-suffixed relative import the built package uses.
describe("@it-core/obsidian", () => {
  it("names itself", () => {
    expect(PACKAGE_NAME).toBe("@it-core/obsidian");
  });
});
