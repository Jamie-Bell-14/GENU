import { NextResponse, type NextRequest } from "next/server";
import { ScriptedDiscoveryEngine } from "@/lib/ai/discovery-engine";
import {
  DIRECTION_APPLICATION_MESSAGES,
  type SafeError,
} from "@/lib/ai/turn-events";
import { DirectionRequestSchema } from "@/lib/services/directions";
import { acceptDirection, recordAudit } from "@/lib/services/trusted-writer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DIRECTION_RATE_LIMIT } from "@/lib/validation/turns";

export const runtime = "nodejs";

function errorResponse(error: SafeError, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * "Add direction" while a turn is running (DESIGN.md §9.3).
 *
 * Treated as a mutation endpoint like any other: authenticate, authorise the
 * project, validate the input, then record. The response states what will
 * happen to the direction, taken from the engine's own declared contract
 * rather than from a hopeful constant, so the promise matches the behaviour.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage:
          "The workspace is not connected to its database in this environment.",
        recoverable: false,
      },
      503,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(
      {
        code: "session_expired",
        userMessage: "Your session has ended. Sign in again to continue.",
        recoverable: true,
      },
      401,
    );
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage: "That project is not available.",
        recoverable: false,
      },
      404,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const parsed = DirectionRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(
      {
        code: "message_too_long",
        userMessage: parsed.error.issues[0].message,
        recoverable: true,
      },
      400,
    );
  }

  const { data: limit, error: limitError } = await supabase
    .rpc("check_rate_limit", {
      p_action: DIRECTION_RATE_LIMIT.action,
      p_limit: DIRECTION_RATE_LIMIT.limit,
      p_window_seconds: DIRECTION_RATE_LIMIT.windowSeconds,
    })
    .single<{ allowed: boolean; retry_after_seconds: number }>();
  if (limitError || !limit.allowed) {
    return errorResponse(
      {
        code: limitError ? "engine_unavailable" : "rate_limited",
        userMessage: limitError
          ? "Your direction could not be recorded. Your text is unchanged — try again."
          : `You have added a lot of direction in a short time. Wait ${limit.retry_after_seconds} seconds — your text is unchanged.`,
        recoverable: true,
        retryAfterSeconds: limitError ? undefined : limit.retry_after_seconds,
      },
      limitError ? 503 : 429,
    );
  }

  /*
    Authorising the project is not enough. The turn must belong to it, and its
    steering window must still be open — a turn that has passed its last
    direction boundary has nothing left to consume one, so accepting there
    would record a promise the system cannot keep.

    This is one locked database operation, not a status read followed by an
    insert: between those two statements the turn could seal its window, and
    the direction would be accepted into a turn that can no longer use it.
  */
  const application = new ScriptedDiscoveryEngine().directionApplication;
  const outcome = await acceptDirection({
    projectId,
    turnId: parsed.data.turnId,
    note: parsed.data.note,
    application,
  });

  if (outcome !== "accepted") {
    await recordAudit({
      projectId,
      actorId: user.id,
      actorKind: "user",
      action: "direction_rejected",
      correlationId: parsed.data.turnId,
      detail: { code: outcome },
    });
    // A missing turn, a foreign turn, a finished one and a sealed one all
    // answer the same way, so the response reveals nothing about which.
    return errorResponse(
      {
        code:
          outcome === "unavailable" ? "engine_unavailable" : "turn_interrupted",
        userMessage:
          outcome === "unavailable"
            ? "Your direction could not be recorded. Your text is unchanged — try again."
            : "That turn is no longer taking direction, so it was not recorded. Your text is unchanged.",
        recoverable: outcome === "unavailable",
      },
      outcome === "unavailable" ? 503 : 409,
    );
  }

  await recordAudit({
    projectId,
    actorId: user.id,
    actorKind: "user",
    action: "direction_recorded",
    correlationId: parsed.data.turnId,
    detail: { application },
  });

  return NextResponse.json({
    application,
    message: DIRECTION_APPLICATION_MESSAGES[application],
  });
}
