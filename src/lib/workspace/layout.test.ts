import { describe, expect, it } from "vitest";
import {
  clampSplit,
  parseLayout,
  persistLayout,
  readStoredLayout,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
} from "./layout";

describe("parseLayout", () => {
  it("returns defaults for null, junk and malformed JSON", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("{ nope")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('"string"')).toEqual(DEFAULT_LAYOUT);
  });

  it("falls back per field and clamps the split", () => {
    expect(
      parseLayout(
        JSON.stringify({ split: 90, navCollapsed: true, mode: "sideways" }),
      ),
    ).toEqual({ split: 75, navCollapsed: true, mode: "balanced" });
    expect(parseLayout(JSON.stringify({ split: 3, mode: "canvas" }))).toEqual({
      split: 25,
      navCollapsed: false,
      mode: "canvas",
    });
  });
});

describe("clampSplit", () => {
  it("keeps the split inside 25–75 and rounds", () => {
    expect(clampSplit(50.4)).toBe(50);
    expect(clampSplit(10)).toBe(25);
    expect(clampSplit(99)).toBe(75);
    expect(clampSplit(Number.NaN)).toBe(DEFAULT_LAYOUT.split);
  });
});

describe("storage round trip", () => {
  it("persists and reads back the same layout", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const layout = {
      split: 62,
      navCollapsed: true,
      mode: "conversation",
    } as const;
    persistLayout(storage, layout);
    expect(store.has(LAYOUT_STORAGE_KEY)).toBe(true);
    expect(readStoredLayout(storage)).toEqual(layout);
  });
});
