"use client";

import { useState } from "react";
import type { ResearchFinding, ResearchSource } from "@/lib/research/types";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * The evidence-led research view (VERTICAL_SLICE_SPEC Step 5,
 * DESIGN.md §11): key finding, a focused visualisation with a data-table
 * alternative, why it matters, source markers with inspectable provenance —
 * and the AI's interpretation kept visibly separate from the source data
 * itself. "Add as evidence" is not a control here: it is the same contextual
 * action every other action resolves to, offered in the conversation's action
 * row once research completes (`src/lib/ai/contextual-actions.ts`).
 *
 * Every finding this renderer can ever be given is demonstration data for the
 * life of this slice (T10: mock provider only) — the label below is
 * therefore unconditional, not a per-finding flag the renderer might get
 * wrong.
 */
export function EvidenceResearchRenderer({
  finding,
  unavailableSources = [],
}: Readonly<{
  finding: ResearchFinding | null;
  /** Sources research has reported unavailable this session (T10 edge case). */
  unavailableSources?: { source: ResearchSource; reason: string }[];
}>) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);

  if (!finding) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="text-fg-secondary text-sm">Research is running…</p>
        <p className="text-fg-tertiary max-w-xs text-xs">
          The finding will appear here once it is ready.
        </p>
      </div>
    );
  }

  const max = Math.max(1, ...finding.visualisation.series.map((p) => p.value));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <header className="flex flex-col gap-2">
        <span className="bg-state-warning/15 text-state-warning w-fit rounded-md px-2 py-0.5 text-xs font-medium">
          Demonstration data — not a live lookup
        </span>
        <h3 className="text-fg-primary text-base font-semibold">
          {finding.title}
        </h3>
      </header>

      <section className="border-edge-subtle bg-evidence-subtle rounded-md border border-l-4 border-l-evidence p-3">
        <p className="text-fg-secondary text-xs font-medium tracking-wide uppercase">
          Key finding
        </p>
        <p className="text-fg-primary mt-1 text-sm">{finding.keyFinding}</p>
        {finding.conflicting && (
          <p className="text-state-warning mt-2 text-xs font-medium">
            The available sources disagree on this figure — see sources below.
          </p>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <p className="text-fg-secondary text-xs font-medium tracking-wide uppercase">
            {finding.visualisation.unit}
          </p>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(value) =>
              value && setView(value as "chart" | "table")
            }
            aria-label="Data representation"
          >
            <ToggleGroupItem value="chart">Chart</ToggleGroupItem>
            <ToggleGroupItem value="table">Explore data</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {view === "chart" ? (
          <div className="mt-3 flex flex-col gap-2">
            {finding.visualisation.series.map((point, index) => (
              <div key={point.label} className="flex items-center gap-2">
                <span className="text-fg-secondary w-36 shrink-0 text-xs">
                  {point.label}
                </span>
                <div className="bg-surface-tertiary h-2 flex-1 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      index === 0
                        ? "bg-series-1"
                        : index === 1
                          ? "bg-series-2"
                          : "bg-series-3",
                    )}
                    style={{ width: `${(point.value / max) * 100}%` }}
                  />
                </div>
                <span className="text-fg-primary w-10 shrink-0 text-right text-xs">
                  {point.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-fg-secondary border-edge-subtle border-b text-left">
                <th className="pb-1.5 font-medium">Segment</th>
                <th className="pb-1.5 text-right font-medium">
                  {finding.visualisation.unit}
                </th>
              </tr>
            </thead>
            <tbody>
              {finding.visualisation.series.map((point) => (
                <tr key={point.label} className="border-edge-subtle border-b">
                  <td className="text-fg-primary py-1.5">{point.label}</td>
                  <td className="text-fg-primary py-1.5 text-right">
                    {point.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <p className="text-fg-secondary text-xs font-medium tracking-wide uppercase">
          Why it matters
        </p>
        <p className="text-fg-primary mt-1 text-sm">{finding.whyItMatters}</p>
      </section>

      <section>
        <p className="text-fg-secondary text-xs font-medium tracking-wide uppercase">
          Sources
        </p>
        <ul className="mt-1 flex flex-col gap-1">
          {finding.sources.map((source) => {
            const open = openSourceId === source.id;
            return (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => setOpenSourceId(open ? null : source.id)}
                  aria-expanded={open}
                  className="border-edge-subtle text-fg-primary hover:bg-surface-secondary w-full rounded-md border px-2 py-1.5 text-left text-xs"
                >
                  {source.name}
                </button>
                {open && (
                  <dl className="border-edge-subtle bg-surface-secondary mt-1 rounded-md border p-2.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-fg-secondary">Retrieved</dt>
                      <dd className="text-fg-primary">
                        {new Date(source.retrievedAt).toLocaleString("en-GB")}
                      </dd>
                    </div>
                    <div className="mt-1.5">
                      <dt className="text-fg-secondary">Method</dt>
                      <dd className="text-fg-primary mt-0.5">
                        {finding.methodology}
                      </dd>
                    </div>
                    <div className="mt-1.5">
                      <dt className="text-fg-secondary">Limitations</dt>
                      <dd className="text-fg-primary mt-0.5">
                        {finding.limitations}
                      </dd>
                    </div>
                    <div className="border-edge-subtle mt-1.5 border-t pt-1.5">
                      <dt className="text-fg-secondary">AI interpretation</dt>
                      <dd className="text-fg-primary mt-0.5">
                        Kept separate from this source: see “Key finding” and
                        “Why it matters” above, not this record.
                      </dd>
                    </div>
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {unavailableSources.length > 0 && (
        <section>
          <p className="text-fg-secondary text-xs font-medium tracking-wide uppercase">
            Sources unavailable
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {unavailableSources.map(({ source, reason }) => (
              <li
                key={source.id}
                className="border-edge-subtle text-fg-secondary rounded-md border border-dashed px-2 py-1.5 text-xs"
              >
                <span className="text-fg-primary">{source.name}</span>
                {" — "}
                {reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
