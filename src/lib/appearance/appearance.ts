export const THEME_PREFERENCES = ["dark", "light", "system"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const TEXT_SIZES = ["default", "large"] as const;
export const MOTION_PREFERENCES = ["system", "reduced"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type Density = (typeof DENSITIES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

export interface Appearance {
  theme: ThemePreference;
  density: Density;
  textSize: TextSize;
  motion: MotionPreference;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  density: "comfortable",
  textSize: "default",
  motion: "system",
};

export const APPEARANCE_STORAGE_KEY = "ppm.appearance";

function pick<T extends string>(
  candidates: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return candidates.includes(value as T) ? (value as T) : fallback;
}

/** Parse a stored appearance value; anything invalid falls back per field. */
export function parseAppearance(raw: string | null): Appearance {
  let stored: unknown = null;
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
  }
  const record =
    stored && typeof stored === "object"
      ? (stored as Record<string, unknown>)
      : {};
  return {
    theme: pick(THEME_PREFERENCES, record.theme, DEFAULT_APPEARANCE.theme),
    density: pick(DENSITIES, record.density, DEFAULT_APPEARANCE.density),
    textSize: pick(TEXT_SIZES, record.textSize, DEFAULT_APPEARANCE.textSize),
    motion: pick(MOTION_PREFERENCES, record.motion, DEFAULT_APPEARANCE.motion),
  };
}

export function readStoredAppearance(storage: Pick<Storage, "getItem">) {
  return parseAppearance(storage.getItem(APPEARANCE_STORAGE_KEY));
}

export function persistAppearance(
  storage: Pick<Storage, "setItem">,
  appearance: Appearance,
) {
  storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
}

/** Resolve the concrete theme from the preference and the OS setting. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): "dark" | "light" {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Stamp the appearance onto the root element. The design tokens react to
 * these attributes (data-theme, data-density, data-text-size, data-motion);
 * components never branch on theme themselves.
 */
export function applyAppearance(
  root: HTMLElement,
  appearance: Appearance,
  systemPrefersDark: boolean,
) {
  root.dataset.theme = resolveTheme(appearance.theme, systemPrefersDark);
  root.dataset.density = appearance.density;
  root.dataset.textSize = appearance.textSize;
  if (appearance.motion === "reduced") {
    root.dataset.motion = "reduced";
  } else {
    delete root.dataset.motion;
  }
}

/**
 * Pre-hydration init: runs as an inline script in <head> so the first paint
 * already has the right attributes (no theme flash). Mirrors parseAppearance
 * and applyAppearance for the four attributes — keep the three in sync.
 */
export const APPEARANCE_INIT_SCRIPT = `(function () {
  try {
    var d = { theme: "system", density: "comfortable", textSize: "default", motion: "system" };
    var s = {};
    try { s = JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)}) || "{}") || {}; } catch (e) {}
    var theme = ["dark", "light", "system"].indexOf(s.theme) >= 0 ? s.theme : d.theme;
    if (theme === "system") {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    var r = document.documentElement;
    r.dataset.theme = theme;
    r.dataset.density = ["comfortable", "compact"].indexOf(s.density) >= 0 ? s.density : d.density;
    r.dataset.textSize = ["default", "large"].indexOf(s.textSize) >= 0 ? s.textSize : d.textSize;
    if (s.motion === "reduced") r.dataset.motion = "reduced";
  } catch (e) {}
})();`;
