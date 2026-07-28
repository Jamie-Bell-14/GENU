"use client";

import { HistoryIcon } from "lucide-react";
import type { ActivityLine } from "@/lib/ai/turn-events";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const KIND_LABELS: Record<ActivityLine["kind"], string> = {
  analysis: "Analysis",
  research: "Research",
  model_update: "Project model",
  document_update: "Document",
};

function timeOf(line: ActivityLine): string {
  if (!line.at) return "This session";
  return new Date(line.at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The persistent activity control (DESIGN.md §9.1): temporary lines fade from
 * the working surfaces, but the record of what the system did stays
 * retrievable here rather than being lost with the turn.
 */
export function ActivityHistory({
  lines,
}: Readonly<{ lines: readonly ActivityLine[] }>) {
  const newestFirst = [...lines].reverse();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Activity history">
          <HistoryIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-96 max-w-full">
        <SheetHeader>
          <SheetTitle>Activity</SheetTitle>
          <SheetDescription>
            What the system did, in the order it happened. Each line describes a
            real operation.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {newestFirst.length === 0 ? (
            <p className="text-fg-tertiary text-sm">
              No activity recorded yet. It appears here as work happens.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {newestFirst.map((line) => (
                <li key={line.id} className="flex flex-col gap-0.5">
                  <span className="text-sm break-words">{line.label}</span>
                  <span className="text-fg-tertiary text-xs">
                    {KIND_LABELS[line.kind]} · {timeOf(line)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
