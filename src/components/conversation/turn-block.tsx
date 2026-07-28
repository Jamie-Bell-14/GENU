import { cn } from "@/lib/utils";
import type { TurnBlockKind } from "@/lib/ai/turn-events";

/**
 * Status rail + label per block kind. Meaning is carried by the label text
 * as well as the colour (UI acceptance §11: never colour alone).
 */
const BLOCK_STYLES: Record<
  TurnBlockKind,
  { rail: string; label: string | null }
> = {
  plain: { rail: "", label: null },
  challenge: { rail: "border-l-assumption", label: "Challenge" },
  assumption: { rail: "border-l-assumption", label: "Assumption" },
  finding: { rail: "border-l-evidence", label: "Research finding" },
  proposal: { rail: "border-l-brand", label: "Proposed change" },
  checkpoint: { rail: "border-l-info", label: "Checkpoint" },
};

export function TurnBlock({
  kind,
  heading,
  children,
}: Readonly<{
  kind: TurnBlockKind;
  heading?: string;
  children: React.ReactNode;
}>) {
  const style = BLOCK_STYLES[kind];
  if (kind === "plain") {
    return <div className="text-sm leading-relaxed">{children}</div>;
  }
  return (
    <div
      className={cn(
        "bg-surface-secondary border-edge-subtle rounded-md border border-l-2 p-3",
        style.rail,
      )}
    >
      <p className="text-fg-tertiary mb-1 text-xs font-medium tracking-wide uppercase">
        {style.label}
      </p>
      {heading && <p className="mb-1 text-sm font-medium">{heading}</p>}
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
