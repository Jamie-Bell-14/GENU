"use client";

/*
  Structured inspector and accessible alternative
  (docs/ADAPTIVE_CANVAS_MVP.md §4.4).

  This is the T7 zoned view, retained with its behaviour intact: it inspects
  every visible project object in a predictable order and is the ordered
  structured alternative to the spatial renderers. It reads the same canonical
  project objects as the visual view — switching representation never
  duplicates or mutates project data. The surrounding pane chrome now belongs
  to the scene host, so this component renders content only.
*/
import { useReducer } from "react";
import {
  applyViewOperation,
  buildZones,
  EMPTY_VIEW,
  ZONE_LABELS,
  type CanvasObject,
  type CanvasView,
  type ViewOperation,
} from "@/lib/canvas/model";
import { CanvasObjectCard } from "./canvas-object";
import type { EditSubmit } from "./object-editor";
import { Button } from "@/components/ui/button";

function viewReducer(view: CanvasView, operation: ViewOperation): CanvasView {
  return applyViewOperation(view, operation);
}

export function StructuredInspector({
  objects,
  onFocusObject,
  onEdit,
}: Readonly<{
  objects: CanvasObject[];
  /** Lets the inspector hand an object to the visual relationship map. */
  onFocusObject?: (objectId: string) => void;
  /** Saves edited wording; absent when editing is unavailable. */
  onEdit?: EditSubmit;
}>) {
  const [view, dispatch] = useReducer(viewReducer, EMPTY_VIEW);
  const zones = buildZones(objects, view);
  const changed =
    view.pinned.length > 0 ||
    view.hidden.length > 0 ||
    view.collapsedZones.length > 0 ||
    view.centredOn !== null;

  return (
    <div className="flex flex-col gap-4 p-3">
      {changed && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => dispatch({ type: "reset" })}
          >
            Undo view changes
          </Button>
        </div>
      )}

      {zones.map(({ zone, visible, hiddenCount, overflowCount, collapsed }) => {
        const total =
          visible.length + hiddenCount + (collapsed ? overflowCount : 0);
        if (total === 0 && overflowCount === 0) return null;
        return (
          <section key={zone} aria-label={ZONE_LABELS[zone]}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-fg-tertiary text-xs font-medium tracking-wide uppercase">
                {ZONE_LABELS[zone]}
              </h3>
              <Button
                variant="ghost"
                size="xs"
                aria-expanded={!collapsed}
                onClick={() =>
                  dispatch({
                    type: collapsed ? "expand_zone" : "collapse_zone",
                    zone,
                  })
                }
              >
                {collapsed ? "Expand" : "Collapse"}
              </Button>
            </div>

            {!collapsed && (
              <div className="flex flex-col gap-2">
                {visible.map((object) => (
                  <CanvasObjectCard
                    key={object.id}
                    object={object}
                    pinned={view.pinned.includes(object.id)}
                    centred={view.centredOn === object.id}
                    onOperation={dispatch}
                    onFocusInMap={onFocusObject}
                    onEdit={onEdit}
                  />
                ))}
              </div>
            )}

            {/* Withheld objects are always counted, never silently dropped. */}
            {(overflowCount > 0 || hiddenCount > 0) && (
              <p className="text-fg-tertiary mt-2 text-xs">
                {overflowCount > 0 && `${overflowCount} more in this area`}
                {overflowCount > 0 && hiddenCount > 0 && " · "}
                {hiddenCount > 0 && `${hiddenCount} hidden`}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
