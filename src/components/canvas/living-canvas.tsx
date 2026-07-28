"use client";

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
import { Button } from "@/components/ui/button";

function viewReducer(view: CanvasView, operation: ViewOperation): CanvasView {
  return applyViewOperation(view, operation);
}

function EmptyCanvas() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-fg-secondary text-sm">
        The canvas fills in as the conversation goes on.
      </p>
      <p className="text-fg-tertiary max-w-xs text-xs">
        It starts sparse on purpose: only what you have said, and what has been
        inferred from it, appear here.
      </p>
    </div>
  );
}

export function LivingCanvas({
  objects,
  loading = false,
  error = null,
}: Readonly<{
  objects: CanvasObject[];
  loading?: boolean;
  error?: string | null;
}>) {
  const [view, dispatch] = useReducer(viewReducer, EMPTY_VIEW);
  const zones = buildZones(objects, view);
  const changed =
    view.pinned.length > 0 ||
    view.hidden.length > 0 ||
    view.collapsedZones.length > 0 ||
    view.centredOn !== null;

  return (
    <section
      id="canvas-pane"
      aria-label="Living canvas"
      tabIndex={-1}
      className="bg-surface-canvas flex h-full min-h-0 flex-col"
    >
      <div className="border-edge-subtle flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-fg-secondary text-xs font-medium tracking-wide uppercase">
          Project canvas
        </h2>
        {changed && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => dispatch({ type: "reset" })}
          >
            Undo view changes
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p
            role="alert"
            className="text-state-error border-risk-edge bg-risk-subtle rounded-md border p-3 text-sm"
          >
            {error}
          </p>
        ) : loading ? (
          <p className="text-fg-tertiary p-3 text-sm">
            Loading the project model…
          </p>
        ) : objects.length === 0 ? (
          <EmptyCanvas />
        ) : (
          <div className="flex flex-col gap-4">
            {zones.map(
              ({ zone, visible, hiddenCount, overflowCount, collapsed }) => {
                const total =
                  visible.length +
                  hiddenCount +
                  (collapsed ? overflowCount : 0);
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
                          />
                        ))}
                      </div>
                    )}

                    {/* Withheld objects are always counted, never silently
                        dropped. */}
                    {(overflowCount > 0 || hiddenCount > 0) && (
                      <p className="text-fg-tertiary mt-2 text-xs">
                        {overflowCount > 0 &&
                          `${overflowCount} more in this area`}
                        {overflowCount > 0 && hiddenCount > 0 && " · "}
                        {hiddenCount > 0 && `${hiddenCount} hidden`}
                      </p>
                    )}
                  </section>
                );
              },
            )}
          </div>
        )}
      </div>
    </section>
  );
}
