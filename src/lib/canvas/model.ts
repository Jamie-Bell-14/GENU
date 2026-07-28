/**
 * Canvas object grammar (DESIGN.md §10). A controlled set of object types
 * sharing one visual frame; objects differ by content and status, never by
 * bespoke shapes — the canvas is not flowchart software.
 */
export const OBJECT_KINDS = [
  "concept",
  "evidence",
  "assumption",
  "decision",
  "document",
  "visualisation",
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/** Where a claim came from — always rendered as text, never colour alone. */
export const ORIGINS = ["user_stated", "ai_inferred", "researched"] as const;
export type Origin = (typeof ORIGINS)[number];

export const SUPPORT_STATES = [
  "unexplored",
  "hypothesis",
  "some_evidence",
  "credible",
  "strongly_evidenced",
  "contradicted",
] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

/** Canvas zones (docs/review 02 §U2: structured layout, not free movement). */
export const ZONES = [
  "subject",
  "related",
  "evidence",
  "assumptions",
  "outline",
] as const;
export type Zone = (typeof ZONES)[number];

export interface CanvasObject {
  id: string;
  kind: ObjectKind;
  zone: Zone;
  title: string;
  detail?: string;
  origin: Origin;
  support?: SupportState;
  /** Compact technical metadata (source, updated date). */
  meta?: string;
  /**
   * Which underlying table owns this object, so an edit can be routed
   * without the UI guessing from the object kind.
   */
  editable?: { kind: "field" | "assumption"; text: string };
  /** Assumption presentation data (DESIGN.md §10.3). */
  alternatives?: string[];
  recommendedValidation?: string;
}

export const ORIGIN_LABELS: Record<Origin, string> = {
  user_stated: "You stated",
  ai_inferred: "Inferred",
  researched: "Researched",
};

export const SUPPORT_LABELS: Record<SupportState, string> = {
  unexplored: "Unexplored",
  hypothesis: "Hypothesis",
  some_evidence: "Some supporting evidence",
  credible: "Credible",
  strongly_evidenced: "Strongly evidenced",
  contradicted: "Contradicted",
};

export const ZONE_LABELS: Record<Zone, string> = {
  subject: "Current subject",
  related: "Related concepts",
  evidence: "Evidence",
  assumptions: "Assumptions",
  outline: "Project outline",
};

export const KIND_LABELS: Record<ObjectKind, string> = {
  concept: "Concept",
  evidence: "Evidence",
  assumption: "Assumption",
  decision: "Decision",
  document: "Document",
  visualisation: "Visualisation",
};

/** Objects shown per zone before the rest collapse behind an honest count. */
export const ZONE_VISIBLE_LIMIT = 4;

export interface CanvasView {
  pinned: string[];
  hidden: string[];
  collapsedZones: Zone[];
  /** Object the canvas is centred on; null means the default subject. */
  centredOn: string | null;
}

export const EMPTY_VIEW: CanvasView = {
  pinned: [],
  hidden: [],
  collapsedZones: [],
  centredOn: null,
};

export type ViewOperation =
  | { type: "pin"; id: string }
  | { type: "unpin"; id: string }
  | { type: "hide"; id: string }
  | { type: "show"; id: string }
  | { type: "collapse_zone"; zone: Zone }
  | { type: "expand_zone"; zone: Zone }
  | { type: "recentre"; id: string | null }
  | { type: "reset" };

function without<T>(list: T[], value: T): T[] {
  return list.filter((item) => item !== value);
}

function withValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list : [...list, value];
}

export function applyViewOperation(
  view: CanvasView,
  operation: ViewOperation,
): CanvasView {
  switch (operation.type) {
    case "pin":
      // Pinning something hidden also reveals it: the two states contradict.
      return {
        ...view,
        pinned: withValue(view.pinned, operation.id),
        hidden: without(view.hidden, operation.id),
      };
    case "unpin":
      return { ...view, pinned: without(view.pinned, operation.id) };
    case "hide":
      return {
        ...view,
        hidden: withValue(view.hidden, operation.id),
        pinned: without(view.pinned, operation.id),
        centredOn: view.centredOn === operation.id ? null : view.centredOn,
      };
    case "show":
      return { ...view, hidden: without(view.hidden, operation.id) };
    case "collapse_zone":
      return {
        ...view,
        collapsedZones: withValue(view.collapsedZones, operation.zone),
      };
    case "expand_zone":
      return {
        ...view,
        collapsedZones: without(view.collapsedZones, operation.zone),
      };
    case "recentre":
      return { ...view, centredOn: operation.id };
    case "reset":
      return EMPTY_VIEW;
  }
}

export interface ZoneContents {
  zone: Zone;
  visible: CanvasObject[];
  hiddenCount: number;
  overflowCount: number;
  collapsed: boolean;
}

/**
 * Produces the ordered, zoned view model the canvas renders. Pinned objects
 * sort first; hidden objects are counted rather than silently dropped so the
 * user can always tell something is being withheld.
 */
export function buildZones(
  objects: CanvasObject[],
  view: CanvasView,
): ZoneContents[] {
  const centred = view.centredOn
    ? objects.find((object) => object.id === view.centredOn)
    : undefined;

  return ZONES.map((zone) => {
    let inZone = objects.filter((object) => object.zone === zone);
    // Re-centring promotes the chosen object into the subject zone and
    // demotes the default subject to related context.
    if (centred) {
      if (zone === "subject") {
        inZone = [centred];
      } else if (zone === "related") {
        inZone = [
          ...objects.filter(
            (object) => object.zone === "subject" && object.id !== centred.id,
          ),
          ...inZone.filter((object) => object.id !== centred.id),
        ];
      } else {
        inZone = inZone.filter((object) => object.id !== centred.id);
      }
    }

    const hiddenCount = inZone.filter((object) =>
      view.hidden.includes(object.id),
    ).length;
    const shown = inZone
      .filter((object) => !view.hidden.includes(object.id))
      .sort((a, b) => {
        const pinnedDelta =
          Number(view.pinned.includes(b.id)) -
          Number(view.pinned.includes(a.id));
        return pinnedDelta;
      });
    const collapsed = view.collapsedZones.includes(zone);
    const visible = collapsed ? [] : shown.slice(0, ZONE_VISIBLE_LIMIT);

    return {
      zone,
      visible,
      hiddenCount,
      overflowCount: collapsed
        ? shown.length
        : Math.max(0, shown.length - ZONE_VISIBLE_LIMIT),
      collapsed,
    };
  });
}
