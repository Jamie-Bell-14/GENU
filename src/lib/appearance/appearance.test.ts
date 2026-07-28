import { describe, expect, it } from "vitest";
import {
  applyAppearance,
  parseAppearance,
  persistAppearance,
  readStoredAppearance,
  resolveTheme,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
} from "./appearance";

describe("parseAppearance", () => {
  it("returns defaults for null, junk and malformed JSON", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("not json {")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(JSON.stringify("a string"))).toEqual(
      DEFAULT_APPEARANCE,
    );
  });

  it("falls back per field when a stored value is invalid", () => {
    const parsed = parseAppearance(
      JSON.stringify({ theme: "light", density: "cosy", motion: "reduced" }),
    );
    expect(parsed).toEqual({
      theme: "light",
      density: "comfortable",
      textSize: "default",
      motion: "reduced",
    });
  });
});

describe("storage round trip", () => {
  it("persists and reads back the same appearance", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const appearance = {
      theme: "light",
      density: "compact",
      textSize: "large",
      motion: "reduced",
    } as const;
    persistAppearance(storage, appearance);
    expect(store.has(APPEARANCE_STORAGE_KEY)).toBe(true);
    expect(readStoredAppearance(storage)).toEqual(appearance);
  });
});

describe("resolveTheme", () => {
  it("passes explicit preferences through and resolves system from the OS", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("applyAppearance", () => {
  it("stamps all attributes and only sets data-motion when reduced", () => {
    const root = document.createElement("div");
    applyAppearance(
      root,
      {
        theme: "system",
        density: "compact",
        textSize: "large",
        motion: "reduced",
      },
      true,
    );
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.density).toBe("compact");
    expect(root.dataset.textSize).toBe("large");
    expect(root.dataset.motion).toBe("reduced");

    applyAppearance(root, DEFAULT_APPEARANCE, false);
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.density).toBe("comfortable");
    expect(root.dataset.textSize).toBe("default");
    expect(root.dataset.motion).toBeUndefined();
  });
});
