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
 * Opens a turn: saves the user's message and the operational record together.
 *
 * Unlike audit and activity this is *not* best-effort — steering and recovery
 * read the run, so a turn that cannot record that it is running must not open a
 * stream and advertise controls that cannot work.
 *
 * Both writes go through one function so they are one transaction. Saving the
 * message first and opening the run afterwards left an orphan message behind
 * every refused start, which the client then re-sent as a duplicate. The
 * function also reconciles a run whose lease has lapsed, so a dead worker
 * cannot hold the project's only slot for ever (issue #11).
 */
export type StartTurnOutcome =
  | "started"
  /** Another turn is genuinely still running for this project (concurrency). */
  | "already_running"
  /** Nothing was written; the turn must not start. */
  | "unavailable";

export async function startTurn(input: {
  projectId: string;
  turnId: string;
  content: string;
}): Promise<StartTurnOutcome> {
  const client = trustedClient();
  if (!client) {
    reportUnavailable("turn_run");
    return "unavailable";
  }
  const { data, error } = await client.rpc("start_turn", {
    p_project_id: input.projectId,
    p_turn_id: input.turnId,
    p_content: input.content,
  });
  if (error) {
    // No content in the log (SECURITY_STANDARDS §14.1).
    console.error("start_turn failed", { code: error.code });
    return "unavailable";
  }
  return data === "started" ? "started" : "already_running";
}

/**
 * Records the turn's outcome, exactly once, and closes the steering window
 * with it. The update is constrained to a still-running row, so a second
 * terminal write cannot overwrite the first.
 *
 * A transient failure here would leave the run eligible for direction and
 * recoverable for ever, so it is retried a bounded number of times; the row's
 * lease is what bounds the damage if every attempt fails.
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error, count } = await client
      .from("turn_runs")
      .update(
        {
          state: input.state,
          accepting_direction: false,
          ended_at: new Date().toISOString(),
        },
        { count: "exact" },
      )
      .eq("turn_id", input.turnId)
      .eq("state", "running");
    if (!error) return count === 1;
    console.error("turn_run close failed", {
      code: error.code,
      attempt: attempt + 1,
    });
  }
  return false;
}

export type LeaseRenewal =
  | "renewed"
  /** No such run. */
  | "unknown"
  /** The turn already has an outcome; a heartbeat may not revise it. */
  | "finished"
  /** The lease lapsed before this arrived; the run is not revived. */
  | "expired"
  /** The renewal did not happen; the lease is unchanged. */
  | "unavailable";

/**
 * Extends a running turn's lease (issue #11).
 *
 * The bound this maintains is "a run whose worker is gone stops being
 * steerable and recoverable". Renewal is therefore evidence of life, nothing
 * more: it cannot revive a finished or already-expired run, and the database
 * enforces that under a row lock rather than trusting callers to check first.
 */
export async function renewTurnLease(input: {
  turnId: string;
  seconds: number;
}): Promise<LeaseRenewal> {
  const client = trustedClient();
  if (!client) {
    reportUnavailable("turn_lease");
    return "unavailable";
  }
  const { data, error } = await client.rpc("renew_turn_lease", {
    p_turn_id: input.turnId,
    p_seconds: input.seconds,
  });
  if (error) {
    console.error("renew_turn_lease failed", { code: error.code });
    return "unavailable";
  }
  return data as LeaseRenewal;
}

export type DirectionOutcome =
  | "accepted"
  | "unknown"
  | "finished"
  | "expired"
  | "closed"
  | "too_many"
  | "unavailable";

/**
 * Accepts a direction only if the turn's steering window is still open, as one
 * locked operation. A status read followed by an insert leaves a window in
 * which the turn passes its last direction boundary between the two.
 */
export async function acceptDirection(input: {
  projectId: string;
  turnId: string;
  note: string;
  application: DirectionApplication;
}): Promise<DirectionOutcome> {
  const client = trustedClient();
  if (!client) {
    reportUnavailable("direction");
    return "unavailable";
  }
  const { data, error } = await client.rpc("accept_turn_direction", {
    p_project_id: input.projectId,
    p_turn_id: input.turnId,
    p_note: input.note,
    p_application: input.application,
  });
  if (error) {
    console.error("accept_turn_direction failed", { code: error.code });
    return "unavailable";
  }
  return data as DirectionOutcome;
}

export interface DirectionCursor {
  createdAt: string;
  id: string;
}

/** The cursor a turn starts from: before everything. */
export const DIRECTION_CURSOR_START: DirectionCursor = {
  createdAt: new Date(0).toISOString(),
  id: "00000000-0000-0000-0000-000000000000",
};

export type TakeDirectionsResult =
  | { ok: true; directions: { note: string; cursor: DirectionCursor }[] }
  /** The read — and therefore the seal — did not happen. */
  | { ok: false };

/**
 * Reads directions after `after` and, at the final boundary, seals the window
 * in the same transaction — so a direction is either inserted before sealing
 * and consumed here, or refused.
 *
 * The result is discriminated rather than "an empty array". At a final
 * boundary those two are not the same thing: no rows means the window is
 * sealed and nothing was pending, while a failure means the window may still
 * be open and a later direction could still be accepted into a turn with no
 * boundary left to use it.
 */
export async function takeDirections(input: {
  projectId: string;
  turnId: string;
  after: DirectionCursor;
  seal: boolean;
}): Promise<TakeDirectionsResult> {
  const client = trustedClient();
  if (!client) {
    reportUnavailable("take_directions");
    return { ok: false };
  }
  const { data, error } = await client.rpc("take_turn_directions", {
    p_project_id: input.projectId,
    p_turn_id: input.turnId,
    p_after_created_at: input.after.createdAt,
    p_after_id: input.after.id,
    p_seal: input.seal,
  });
  if (error) {
    console.error("take_turn_directions failed", { code: error.code });
    return { ok: false };
  }
  return {
    ok: true,
    directions: (
      (data ?? []) as { id: string; note: string; created_at: string }[]
    ).map((row) => ({
      note: row.note,
      cursor: { createdAt: row.created_at, id: row.id },
    })),
  };
}

export type AuditAction =
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "direction_recorded"
  | "direction_rejected"
  | "scene_recommended"
  | "scene_rejected"
  | "operation_applied"
  | "operation_rejected"
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
