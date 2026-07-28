"use client";

import type { ActivityLine } from "@/lib/ai/turn-events";
import { cn } from "@/lib/utils";

/**
 * One line of observable work (DESIGN.md §9.1–9.2).
 *
 * The live region is always in the DOM, so a change is announced rather than
 * the region appearing and being missed. It is `polite`: activity is
 * information, never an interruption.
 *
 * There is no progress bar and no percentage — the system reports what it is
 * doing, not how far through it imagines it is.
 */
export function ActivityIndicator({
  activity,
  className,
}: Readonly<{ activity: ActivityLine | null; className?: string }>) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "text-fg-tertiary flex items-center gap-2 text-xs",
        className,
      )}
    >
      {activity && (
        <>
          <span
            aria-hidden
            /* Motion is a token, so reduced-motion settings stop it. */
            className="bg-fg-tertiary size-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
          />
          <span className="truncate">{activity.label}</span>
        </>
      )}
    </div>
  );
}
