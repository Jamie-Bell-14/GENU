import { describe, expect, it } from "vitest";

/**
 * The module holds an elevated key, so it must never end up in a browser
 * bundle. This test runs in the jsdom environment — where `window` exists — and
 * proves the guard refuses to load rather than relying on convention.
 */
describe("the trusted writer in a browser environment", () => {
  it("refuses to load at all", async () => {
    await expect(import("./trusted-writer")).rejects.toThrow(
      /never be imported into client code/,
    );
  });
});
