import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchFinding, ResearchSource } from "@/lib/research/types";
import type { CanvasObject, Origin, SupportState } from "./model";
import type { ProjectRelationship, RelationshipType } from "./relationships";

interface FieldRow {
  id: string;
  area: string;
  label: string;
  value: string;
  origin: Origin;
  support: SupportState;
  updated_at: string;
}

interface AssumptionRow {
  id: string;
  statement: string;
  why_it_matters: string | null;
  status: string;
  origin: Origin;
  alternatives: unknown;
  recommended_validation: string | null;
}

interface EvidenceRow {
  id: string;
  title: string;
  summary: string;
  source_name: string;
  is_demo: boolean;
  source_receipt_id: string;
}

interface ReceiptProvenanceRow {
  id: string;
  sources: unknown;
  conflicting: boolean;
  methodology: string;
  limitations: string;
  retrieved_at: string;
}

interface EvidenceNoteRow {
  from_object_id: string;
  note: string | null;
}

const ASSUMPTION_SUPPORT: Record<string, SupportState> = {
  open: "hypothesis",
  supported: "some_evidence",
  weakened: "hypothesis",
  invalidated: "contradicted",
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB");
}

/**
 * A read that reports whether it worked.
 *
 * An empty project and a failed query produce the same array, so callers that
 * act on completeness — the turn's project-model step, scene validation — need
 * the two told apart rather than inferred.
 */
export interface LoadResult<T> {
  data: T;
  failed: boolean;
}

/**
 * Reads the project model and maps it into canvas objects. All access runs
 * through the caller's user-scoped client, so RLS applies underneath the
 * route's own ownership check (defence in depth).
 */
export async function loadCanvasObjects(
  supabase: SupabaseClient,
  projectId: string,
): Promise<LoadResult<CanvasObject[]>> {
  const [fields, assumptions, evidence, evidenceNotes, receipts] =
    await Promise.all([
      supabase
        .from("project_fields")
        .select("id, area, label, value, origin, support, updated_at")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: true })
        .limit(100),
      supabase
        .from("assumptions")
        .select(
          "id, statement, why_it_matters, status, origin, alternatives, recommended_validation",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(50),
      // Evidence's own id is its canvas-object identity (T10 review round 1,
      // P0-3) — it is registered in `project_objects`, the same registry
      // every other object kind uses, rather than a bespoke link row
      // standing in for it.
      supabase
        .from("evidence")
        .select("id, title, summary, source_name, is_demo, source_receipt_id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(100),
      // What a piece of evidence changes lives on the canonical relationship
      // that connects it to the object it supports or contradicts, not on
      // the evidence row itself — the same relationship the visual map
      // renders (P0-3: structured and visual views consume the same
      // canonical data).
      supabase
        .from("project_relationships")
        .select("from_object_id, note")
        .eq("project_id", projectId)
        .in("relation", ["supports", "contradicts", "affects"])
        .limit(200),
      // The receipt behind each piece of evidence, so its full source set,
      // methodology, limitations and conflict record stay inspectable after
      // a reload (T10 review round 2, P0-C) — read alongside everything
      // else, by project, rather than in a second round trip keyed off the
      // evidence rows above.
      supabase
        .from("research_findings")
        .select(
          "id, sources, conflicting, methodology, limitations, retrieved_at",
        )
        .eq("project_id", projectId)
        .limit(100),
    ]);
  const consequenceByEvidenceId = new Map(
    ((evidenceNotes.data ?? []) as EvidenceNoteRow[]).map((row) => [
      row.from_object_id,
      row.note,
    ]),
  );
  const receiptById = new Map(
    ((receipts.data ?? []) as ReceiptProvenanceRow[]).map((row) => [
      row.id,
      row,
    ]),
  );

  const objects: CanvasObject[] = [];

  for (const row of (fields.data ?? []) as FieldRow[]) {
    objects.push({
      id: row.id,
      kind: row.area === "problem" ? "concept" : "document",
      zone: row.area === "problem" ? "subject" : "outline",
      title: row.label,
      detail: row.value,
      origin: row.origin,
      support: row.support,
      meta: shortDate(row.updated_at),
      editable: { kind: "field", text: row.value },
    });
  }

  for (const row of (assumptions.data ?? []) as AssumptionRow[]) {
    objects.push({
      id: row.id,
      kind: "assumption",
      zone: "assumptions",
      title: row.statement,
      detail: row.why_it_matters ?? undefined,
      origin: row.origin,
      support: ASSUMPTION_SUPPORT[row.status] ?? "hypothesis",
      editable: { kind: "assumption", text: row.statement },
      // The database constrains alternatives to a string array; the guard
      // keeps a malformed legacy row from reaching the renderer.
      alternatives: Array.isArray(row.alternatives)
        ? row.alternatives.filter(
            (item): item is string => typeof item === "string",
          )
        : undefined,
      recommendedValidation: row.recommended_validation ?? undefined,
    });
  }

  for (const row of (evidence.data ?? []) as EvidenceRow[]) {
    const receipt = receiptById.get(row.source_receipt_id);
    objects.push({
      id: row.id,
      kind: "evidence",
      zone: "evidence",
      title: row.title,
      // Falls back to the evidence's own summary if no relationship note was
      // recorded — every evidence row this slice produces has one, but a
      // future direct-add path is not assumed to.
      detail: consequenceByEvidenceId.get(row.id) ?? row.summary,
      origin: "researched",
      meta: row.is_demo
        ? `${row.source_name} · Demonstration data`
        : row.source_name,
      evidenceProvenance: receipt
        ? {
            sources: (receipt.sources ?? []) as ResearchSource[],
            conflicting: receipt.conflicting,
            methodology: receipt.methodology,
            limitations: receipt.limitations,
            retrievedAt: receipt.retrieved_at,
          }
        : undefined,
    });
  }

  return {
    data: objects,
    failed:
      Boolean(fields.error) ||
      Boolean(assumptions.error) ||
      Boolean(evidence.error) ||
      Boolean(evidenceNotes.error) ||
      Boolean(receipts.error),
  };
}

interface RelationshipRow {
  id: string;
  from_object_id: string;
  to_object_id: string;
  relation: RelationshipType;
  origin: Origin;
  support: SupportState;
  note: string | null;
}

/**
 * Loads stored relationships for a project. Renderers display only what this
 * returns — a relationship that is not stored is never drawn
 * (docs/AI_SYSTEM.md §9.2). RLS scopes the query to the caller's project.
 */
export async function loadProjectRelationships(
  supabase: SupabaseClient,
  projectId: string,
): Promise<LoadResult<ProjectRelationship[]>> {
  const { data, error } = await supabase
    .from("project_relationships")
    .select("id, from_object_id, to_object_id, relation, origin, support, note")
    .eq("project_id", projectId)
    .limit(200);

  return {
    data: ((data ?? []) as RelationshipRow[]).map((row) => ({
      id: row.id,
      fromObjectId: row.from_object_id,
      toObjectId: row.to_object_id,
      relation: row.relation,
      origin: row.origin,
      support: row.support,
      note: row.note ?? undefined,
    })),
    failed: Boolean(error),
  };
}

interface LatestMessageRow {
  turn_id: string;
  role: string;
}

interface LatestFindingRow {
  id: string;
  turn_id: string;
  title: string;
  key_finding: string;
  why_it_matters: string;
  visualisation: unknown;
  sources: unknown;
  methodology: string;
  limitations: string;
  retrieved_at: string;
  is_demo: boolean;
  conflicting: boolean;
  unavailable_sources: unknown;
}

/**
 * The research receipt "Add as evidence" can still resolve after a reload
 * (T10 review round 2, P0-A).
 *
 * `activeResearch` otherwise lives only in the client's in-memory turn
 * state, which a reload discards — the round-1 fix made the receipt durable
 * in storage, but a durable row nobody hydrates is not durable in the user
 * journey. This reads the most recent research pass and returns it only
 * when it is still what the conversation is actually about: the project's
 * most recent message must be the assistant turn that produced it. Once a
 * later turn has happened, this returns nothing rather than resurrecting
 * older research as though it were current.
 */
export async function loadLatestResearchReceipt(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{
  finding: ResearchFinding;
  /**
   * The turn that produced this receipt, threaded through to
   * `useTurnRuntime` so a hydrated receipt is retired by the same rule a
   * live one is (T10 review round 3, P0-2): the moment any turn *other*
   * than this one completes, not merely on the next reload.
   */
  turnId: string;
  unavailableSources: { source: ResearchSource; reason: string }[];
} | null> {
  const [message, finding] = await Promise.all([
    supabase
      .from("messages")
      .select("turn_id, role")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("research_findings")
      .select(
        "id, turn_id, title, key_finding, why_it_matters, visualisation, sources, methodology, limitations, retrieved_at, is_demo, conflicting, unavailable_sources",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const latestMessage = message.data as LatestMessageRow | null;
  const latestFinding = finding.data as LatestFindingRow | null;
  if (!latestMessage || !latestFinding) return null;
  if (
    latestMessage.role !== "assistant" ||
    latestMessage.turn_id !== latestFinding.turn_id
  ) {
    return null;
  }

  return {
    finding: {
      id: latestFinding.id,
      title: latestFinding.title,
      keyFinding: latestFinding.key_finding,
      whyItMatters: latestFinding.why_it_matters,
      visualisation:
        latestFinding.visualisation as ResearchFinding["visualisation"],
      sources: latestFinding.sources as ResearchSource[],
      methodology: latestFinding.methodology,
      limitations: latestFinding.limitations,
      retrievedAt: latestFinding.retrieved_at,
      isDemo: true,
      conflicting: latestFinding.conflicting,
    },
    turnId: latestFinding.turn_id,
    unavailableSources: (latestFinding.unavailable_sources ?? []) as {
      source: ResearchSource;
      reason: string;
    }[],
  };
}
