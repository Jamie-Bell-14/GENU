"use client";

import { EyeOffIcon, PinIcon, PinOffIcon, TargetIcon } from "lucide-react";
import {
  KIND_LABELS,
  ORIGIN_LABELS,
  SUPPORT_LABELS,
  type CanvasObject,
  type ObjectKind,
  type ViewOperation,
} from "@/lib/canvas/model";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * One frame for every object type (DESIGN.md §10): 8px radius, fine border,
 * a status rail carrying semantic colour, and labels that repeat the meaning
 * in text so nothing depends on colour alone.
 */
const RAIL_BY_KIND: Record<ObjectKind, string> = {
  concept: "border-l-edge-strong",
  evidence: "border-l-evidence",
  assumption: "border-l-assumption",
  decision: "border-l-brand",
  document: "border-l-edge-strong",
  visualisation: "border-l-info",
};

export function CanvasObjectCard({
  object,
  pinned,
  centred,
  onOperation,
}: Readonly<{
  object: CanvasObject;
  pinned: boolean;
  centred: boolean;
  onOperation: (operation: ViewOperation) => void;
}>) {
  return (
    <article
      aria-label={`${KIND_LABELS[object.kind]}: ${object.title}`}
      data-centred={centred || undefined}
      className={cn(
        "group bg-surface-secondary border-edge-subtle rounded-md border border-l-2 p-3",
        RAIL_BY_KIND[object.kind],
        // Inferred material reads as provisional in shape as well as words.
        object.origin === "ai_inferred" && "border-dashed border-l-2",
        centred && "ring-edge-focus ring-1",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-fg-tertiary text-xs font-medium tracking-wide uppercase">
            {KIND_LABELS[object.kind]}
          </p>
          <h4 className="text-sm font-medium break-words">{object.title}</h4>
        </div>
        {pinned && (
          <span className="text-fg-tertiary shrink-0 text-xs">Pinned</span>
        )}
      </div>

      {object.detail && (
        <p className="text-fg-secondary mt-1 text-sm break-words">
          {object.detail}
        </p>
      )}

      <div className="text-fg-tertiary mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>{ORIGIN_LABELS[object.origin]}</span>
        {object.support && <span>{SUPPORT_LABELS[object.support]}</span>}
        {object.meta && <span className="font-mono">{object.meta}</span>}
      </div>

      {/* Every view operation has a keyboard-reachable button: there is no
          drag-only interaction (DESIGN.md §18). */}
      <div className="mt-2 flex gap-1">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={pinned ? `Unpin ${object.title}` : `Pin ${object.title}`}
          aria-pressed={pinned}
          onClick={() =>
            onOperation({ type: pinned ? "unpin" : "pin", id: object.id })
          }
        >
          {pinned ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Hide ${object.title}`}
          onClick={() => onOperation({ type: "hide", id: object.id })}
        >
          <EyeOffIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Re-centre on ${object.title}`}
          aria-pressed={centred}
          onClick={() =>
            onOperation({ type: "recentre", id: centred ? null : object.id })
          }
        >
          <TargetIcon aria-hidden />
        </Button>
      </div>
    </article>
  );
}
