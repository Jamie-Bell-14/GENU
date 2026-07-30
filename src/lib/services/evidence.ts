import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchFinding } from "@/lib/research/types";

/**
 * Writes "Add as evidence" (VERTICAL_SLICE_SPEC Step 6, T10).
 *
 * Runs through the caller's user-scoped client, exactly like
 * `project-model-store.ts` — this is DESIGN.md §13.1's low-risk automatic
 * change, written under the same RLS as any other project row, not through
 * the elevated `complete_turn` path T9 built for staged, transactional
 * project-truth writes. Idempotency is enforced at the database layer on both
 * writes: `evidence` on `(project_id, external_finding_id)`, `evidence_links`
 * on `(evidence_id, object_id)` — a second identical request reuses the first
 * row rather than erroring or duplicating (VERTICAL_SLICE_TASKS T10 edge
 * case: "add-as-evidence twice").
 */
export type WriteEvidenceOutcome = "linked" | "already_linked" | "failed";

const UNIQUE_VIOLATION = "23505";

export async function writeEvidence(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    finding: ResearchFinding;
    objectId: string;
    consequenceSummary: string;
  },
): Promise<WriteEvidenceOutcome> {
  const evidenceId = await getOrCreateEvidence(supabase, input);
  if (!evidenceId) return "failed";

  const { error } = await supabase.from("evidence_links").insert({
    project_id: input.projectId,
    evidence_id: evidenceId,
    object_id: input.objectId,
    consequence_summary: input.consequenceSummary,
  });
  if (!error) return "linked";
  return error.code === UNIQUE_VIOLATION ? "already_linked" : "failed";
}

async function getOrCreateEvidence(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    finding: ResearchFinding;
  },
): Promise<string | null> {
  const existing = await selectEvidenceId(supabase, input);
  if (existing) return existing;

  const primarySource = input.finding.sources[0];
  const { data, error } = await supabase
    .from("evidence")
    .insert({
      project_id: input.projectId,
      title: input.finding.title,
      summary: input.finding.keyFinding,
      source_name: primarySource?.name ?? "Demonstration source",
      source_url: primarySource?.url ?? null,
      retrieved_at: input.finding.retrievedAt,
      methodology: input.finding.methodology,
      limitations: input.finding.limitations,
      kind: "secondary_research",
      is_demo: input.finding.isDemo,
      external_finding_id: input.finding.id,
    })
    .select("id")
    .single();

  if (!error && data) return data.id as string;

  // A concurrent request may have created the same row first; the unique
  // constraint on (project_id, external_finding_id) is what makes that safe
  // to just re-read rather than treat as a failure.
  if (error?.code === UNIQUE_VIOLATION) {
    return selectEvidenceId(supabase, input);
  }
  return null;
}

async function selectEvidenceId(
  supabase: SupabaseClient,
  input: { projectId: string; finding: ResearchFinding },
): Promise<string | null> {
  const { data } = await supabase
    .from("evidence")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("external_finding_id", input.finding.id)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
