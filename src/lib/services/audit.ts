import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Project audit history (SECURITY_STANDARDS §14.2). Separate from activity:
 * activity narrates work the user can see, audit records what happened —
 * including work that was rejected and therefore never shown.
 */
export type AuditAction =
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "direction_recorded"
  | "scene_recommended"
  | "scene_rejected";

export interface AuditInput {
  projectId: string;
  actorId: string;
  /** Model-proposed work is attributed to the system acting for this user. */
  actorKind: "user" | "system";
  action: AuditAction;
  /** What the action concerned, in application terms — never user prose. */
  target?: string;
  correlationId: string;
  /** Small structured context only: codes and counts, never content. */
  detail?: Record<string, string | number | boolean>;
}

export async function recordAudit(
  supabase: SupabaseClient,
  input: AuditInput,
): Promise<void> {
  const { error } = await supabase.from("audit_events").insert({
    project_id: input.projectId,
    actor_id: input.actorId,
    actor_kind: input.actorKind,
    action: input.action,
    target: input.target ?? null,
    correlation_id: input.correlationId,
    detail: input.detail ?? {},
  });
  if (error) {
    // A failed audit write is itself a security-control failure and is logged
    // as one — without the content of what was being audited (§14.1).
    console.error("audit_event insert failed", {
      action: input.action,
      code: error.code,
    });
  }
}
