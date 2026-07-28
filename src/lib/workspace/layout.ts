export const FOCUS_MODES = ["balanced", "conversation", "canvas"] as const;
export type FocusMode = (typeof FOCUS_MODES)[number];

export interface WorkspaceLayout {
  /** Conversation pane share of the working area in balanced mode (%). */
  split: number;
  navCollapsed: boolean;
  mode: FocusMode;
}

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  split: 50,
  navCollapsed: false,
  mode: "balanced",
};

export const LAYOUT_STORAGE_KEY = "ppm.workspace-layout";

const SPLIT_MIN = 25;
const SPLIT_MAX = 75;

export function clampSplit(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_LAYOUT.split;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(value)));
}

/** Parse a stored layout; anything invalid falls back per field. */
export function parseLayout(raw: string | null): WorkspaceLayout {
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
    split:
      typeof record.split === "number"
        ? clampSplit(record.split)
        : DEFAULT_LAYOUT.split,
    navCollapsed:
      typeof record.navCollapsed === "boolean"
        ? record.navCollapsed
        : DEFAULT_LAYOUT.navCollapsed,
    mode: FOCUS_MODES.includes(record.mode as FocusMode)
      ? (record.mode as FocusMode)
      : DEFAULT_LAYOUT.mode,
  };
}

export function readStoredLayout(
  storage: Pick<Storage, "getItem">,
): WorkspaceLayout {
  return parseLayout(storage.getItem(LAYOUT_STORAGE_KEY));
}

export function persistLayout(
  storage: Pick<Storage, "setItem">,
  layout: WorkspaceLayout,
) {
  storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}
