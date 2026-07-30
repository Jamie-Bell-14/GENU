import type { ActivityStep } from "@/lib/ai/activity-steps";
import type { SafeError } from "@/lib/ai/turn-events";

/**
 * The research-provider contract (docs/ARCHITECTURE.md §9), kept in its own
 * module so a real provider can implement it later "with zero UI change" —
 * the doc's own words for why this seam exists.
 *
 * Deliberately not backed by a `research_runs` table or a dedicated
 * `research/route.ts` in this slice. docs/ARCHITECTURE.md §14 states research
 * activity is "streamed live over the turn's SSE connection", and §9 itself
 * marks the exact contract ⚑P3 — open until a real provider exists. T9 already
 * built everything a scripted, in-process research pass needs: a turn's lease
 * survives multi-minute work (`withLeaseHeartbeat`), steering has a durable,
 * turn-scoped channel (`turn_directions` / `accept_turn_direction`), and Stop
 * is the turn's own abort signal. `MockResearchProvider` runs entirely inside
 * one `runTurn` call on that machinery. A provider that must genuinely outlive
 * a single turn is the point at which a dedicated research route would earn
 * its keep — not needed while the only provider is scripted and seconds long.
 */

export interface ResearchTask {
  /** What the user asked to research, quoted for provenance, never a query key. */
  topic: string;
  /** The canvas object this research was launched from, if any. */
  focalObjectId: string | null;
}

export interface ResearchSource {
  id: string;
  name: string;
  /** Deliberately fictional in the mock provider (VERTICAL_SLICE_SPEC §6: "fabricated sources must not look real"). */
  url: string | null;
  retrievedAt: string;
}

export interface ResearchVisualisation {
  kind: "bar";
  unit: string;
  series: { label: string; value: number }[];
}

export interface ResearchFinding {
  /**
   * Stable key into the closed, application-owned finding catalogue
   * (`src/lib/research/findings.ts`). Carried to the client and back so
   * "Add as evidence", in a later turn, can ask the server to write the exact
   * same finding it was shown — the server re-derives every provenance field
   * from this id rather than trusting anything else the client sends back.
   */
  id: string;
  title: string;
  keyFinding: string;
  whyItMatters: string;
  visualisation: ResearchVisualisation;
  sources: ResearchSource[];
  methodology: string;
  limitations: string;
  retrievedAt: string;
  isDemo: true;
  /** At least one source disagrees with the headline figure (DESIGN.md §11). */
  conflicting: boolean;
}

export type ResearchEvent =
  | { type: "step"; step: ActivityStep }
  | { type: "source"; source: ResearchSource }
  | { type: "failed_source"; source: ResearchSource; reason: string }
  | { type: "finding"; finding: ResearchFinding }
  | { type: "done" }
  | { type: "failed"; error: SafeError };

export interface ResearchHandle {
  readonly id: string;
}

/** What steering actually does, stated to the user (DESIGN.md §9.3). */
export type SteerOutcome =
  "applied_now" | "applies_next_step" | "requires_restart";

export interface ResearchProvider {
  start(
    task: ResearchTask,
    onEvent: (event: ResearchEvent) => void,
  ): ResearchHandle;
  steer(handle: ResearchHandle, direction: string): SteerOutcome;
  stop(handle: ResearchHandle): void;
}
