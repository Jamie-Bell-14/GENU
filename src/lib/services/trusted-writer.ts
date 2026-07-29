import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ActivityStep, ActivityState } from "@/lib/ai/activity-steps";
import type { DirectionApplication } from "@/lib/ai/turn-events";

/**
 * The trusted writer for activity, audit and steering history.
 *
 * Append-only tables stop history being rewritten; they do not stop it being
 * fabricated. If the browser-authenticated role could INSERT, a project owner
 * could mint activity that never happened and audit rows attributing actions
 * to the system. So `authenticated` has no write grant on those tables at all
 * (see supabase/migrations/20260728170000_activity_audit.sql) and every write
 * goes through here, under an elevated key that exists only in server
 * environment variables (SECURITY_STANDARDS §11.2).
 *
 * The elevated client bypasses RLS, so authorisation is the caller's
 * responsibility and happens *before* this module is reached: routes
 * authenticate the user and confirm project ownership through the user-scoped
 * client first. To keep that contract enforceable, this module exports no
 * client — only the specific records it is allowed to write.
 */

if (typeof window !== "undefined") {
  throw new Error(
    "trusted-writer must never be imported into client code: it holds an elevated key.",
  );
}

let cached: SupabaseClient | null = null;

function trustedClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** True when history can be written in this environment. */
export function trustedWriterAvailable(): boolean {
  return trustedClient() !== null;
}

function reportUnavailable(what: string) {
  // A missing elevated key means history is not being recorded. That is an
  // operational failure and must be visible, not silent.
  console.error("trusted writer unavailable; not recorded", { what });
}

/**
 * Records one report of a step. A step is reported twice — running, then
 * finished — as two append-only rows sharing an operation id; the reader
 * collapses them back into one line per invocation.
 */
export async function recordActivity(input: {
  projectId: string;
  turnId: string;
  operationId: string;
  step: ActivityStep;
  state: ActivityState;
}): Promise<void> {
  const client = trustedClient();
  if (!client) return reportUnavailable("activity");
  const { error } = await client.from("activity_events").insert({
    project_id: input.projectId,
    turn_id: input.turnId,
    operation_id: input.operationId,
    step: input.step,
    state: input.state,
  });
  if (error) {
    // Activity is a narration of work, not the work itself: a failed insert
    // must not abort a turn the user is watching. It is still logged as an
    // operational failure (no project content — SECURITY_STANDARDS §14.1).
    console.error("activity_event insert failed", { code: error.code });
  }
}

/**
 * Opens a turn's operational record. Unlike audit and activity this is *not*
 * best-effort: steering and recovery read it, so a turn that cannot record
 * that it is running must not open a stream and advertise controls that
 * cannot work. Returns whether the record exists.
 */
export async function openTurnRun(input: {
  projectId: string;
  turnId: string;
}): Promise<boolean> {
  const client = trustedClient();
  if (!client) {
    reportUnavailable("turn_run");
    return false;
  }
  const { error } = await client.from("turn_runs").insert({
    turn_id: input.turnId,
    project_id: input.projectId,
    state: "running",
  });
  if (error) {
    console.error("turn_run insert failed", { code: error.code });
    return false;
  }
  return true;
}

/**
 * Records the turn's outcome, exactly once. The update is constrained to a
 * still-running row, so a second terminal write cannot overwrite the first.
 */
export async function closeTurnRun(input: {
  turnId: string;
  state: "completed" | "failed";
}): Promise<boolean> {
  const client = trustedClient();
  if (!client) {
    reportUnavailable("turn_run_close");
    return false;
  }
  const { error, count } = await client
    .from("turn_runs")
    .update(
      { state: input.state, ended_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("turn_id", input.turnId)
    .eq("state", "running");
  if (error) {
    console.error("turn_run close failed", { code: error.code });
    return false;
  }
  return count === 1;
}

export type AuditAction =
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "direction_recorded"
  | "direction_rejected"
  | "scene_recommended"
  | "scene_rejected"
  | "object_edited"
  | "scope_truncated";

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

export async function recordAudit(input: AuditInput): Promise<void> {
  const client = trustedClient();
  if (!client) return reportUnavailable(`audit:${input.action}`);
  const { error } = await client.from("audit_events").insert({
    project_id: input.projectId,
    actor_id: input.actorId,
    actor_kind: input.actorKind,
    action: input.action,
    target: input.target ?? null,
    correlation_id: input.correlationId,
    detail: input.detail ?? {},
  });
  if (error) {
    // A failed audit write is a security-control failure and is logged as one,
    // without the content of what was being audited (§14.1). It does not
    // destroy a completed user result.
    console.error("audit_event insert failed", {
      action: input.action,
      code: error.code,
    });
  }
}

export async function recordDirection(input: {
  projectId: string;
  turnId: string;
  note: string;
  application: DirectionApplication;
}): Promise<boolean> {
  const client = trustedClient();
  if (!client) {
    reportUnavailable("direction");
    return false;
  }
  const { error } = await client.from("turn_directions").insert({
    project_id: input.projectId,
    turn_id: input.turnId,
    note: input.note,
    application: input.application,
  });
  if (error) {
    console.error("turn_direction insert failed", { code: error.code });
    return false;
  }
  return true;
}
