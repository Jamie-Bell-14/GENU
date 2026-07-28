import { describe, expect, it } from "vitest";
import {
  applyViewOperation,
  buildZones,
  EMPTY_VIEW,
  ZONE_VISIBLE_LIMIT,
  type CanvasObject,
  type CanvasView,
} from "./model";

function object(
  id: string,
  overrides: Partial<CanvasObject> = {},
): CanvasObject {
  return {
    id,
    kind: "concept",
    zone: "related",
    title: `Object ${id}`,
    origin: "ai_inferred",
    ...overrides,
  };
}

const subject = object("s1", { zone: "subject", origin: "user_stated" });

function zone(objects: CanvasObject[], view: CanvasView, name: string) {
  return buildZones(objects, view).find((z) => z.zone === name)!;
}

describe("applyViewOperation", () => {
  it("pins and unpins", () => {
    const pinned = applyViewOperation(EMPTY_VIEW, { type: "pin", id: "a" });
    expect(pinned.pinned).toEqual(["a"]);
    expect(
      applyViewOperation(pinned, { type: "unpin", id: "a" }).pinned,
    ).toEqual([]);
  });

  it("pinning a hidden object also reveals it", () => {
    const hidden = applyViewOperation(EMPTY_VIEW, { type: "hide", id: "a" });
    const pinned = applyViewOperation(hidden, { type: "pin", id: "a" });
    expect(pinned.hidden).toEqual([]);
    expect(pinned.pinned).toEqual(["a"]);
  });

  it("hiding the centred object clears the centre", () => {
    const centred = applyViewOperation(EMPTY_VIEW, {
      type: "recentre",
      id: "a",
    });
    expect(
      applyViewOperation(centred, { type: "hide", id: "a" }).centredOn,
    ).toBeNull();
  });

  it("collapses and expands zones, and resets everything", () => {
    let view = applyViewOperation(EMPTY_VIEW, {
      type: "collapse_zone",
      zone: "evidence",
    });
    expect(view.collapsedZones).toEqual(["evidence"]);
    view = applyViewOperation(view, { type: "expand_zone", zone: "evidence" });
    expect(view.collapsedZones).toEqual([]);

    view = applyViewOperation(view, { type: "pin", id: "a" });
    expect(applyViewOperation(view, { type: "reset" })).toEqual(EMPTY_VIEW);
  });

  it("is idempotent for repeated operations", () => {
    const once = applyViewOperation(EMPTY_VIEW, { type: "hide", id: "a" });
    expect(applyViewOperation(once, { type: "hide", id: "a" })).toEqual(once);
  });
});

describe("buildZones", () => {
  it("keeps hidden objects counted rather than silently dropped", () => {
    const objects = [subject, object("a"), object("b")];
    const view = applyViewOperation(EMPTY_VIEW, { type: "hide", id: "a" });
    const related = zone(objects, view, "related");
    expect(related.visible.map((o) => o.id)).toEqual(["b"]);
    expect(related.hiddenCount).toBe(1);
  });

  it("sorts pinned objects first", () => {
    const objects = [object("a"), object("b"), object("c")];
    const view = applyViewOperation(EMPTY_VIEW, { type: "pin", id: "c" });
    expect(zone(objects, view, "related").visible[0].id).toBe("c");
  });

  it("limits each zone and reports the overflow honestly", () => {
    const objects = Array.from({ length: ZONE_VISIBLE_LIMIT + 3 }, (_, i) =>
      object(`o${i}`),
    );
    const related = zone(objects, EMPTY_VIEW, "related");
    expect(related.visible).toHaveLength(ZONE_VISIBLE_LIMIT);
    expect(related.overflowCount).toBe(3);
  });

  it("counts everything as overflow when a zone is collapsed", () => {
    const objects = [object("a"), object("b")];
    const view = applyViewOperation(EMPTY_VIEW, {
      type: "collapse_zone",
      zone: "related",
    });
    const related = zone(objects, view, "related");
    expect(related.visible).toEqual([]);
    expect(related.collapsed).toBe(true);
    expect(related.overflowCount).toBe(2);
  });

  it("re-centring promotes the object and demotes the default subject", () => {
    const objects = [subject, object("a")];
    const view = applyViewOperation(EMPTY_VIEW, { type: "recentre", id: "a" });
    expect(zone(objects, view, "subject").visible.map((o) => o.id)).toEqual([
      "a",
    ]);
    expect(zone(objects, view, "related").visible.map((o) => o.id)).toContain(
      "s1",
    );
  });

  it("falls back to the default subject when the centred object is gone", () => {
    const view: CanvasView = { ...EMPTY_VIEW, centredOn: "deleted" };
    expect(zone([subject], view, "subject").visible.map((o) => o.id)).toEqual([
      "s1",
    ]);
  });
});
