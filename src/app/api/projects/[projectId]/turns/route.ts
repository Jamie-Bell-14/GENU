import { NextResponse, type NextRequest } from "next/server";
import { ScriptedDiscoveryEngine } from "@/lib/ai/discovery-engine";
import { createTurnHooks } from "@/lib/ai/turn-hooks";
import type { SafeError, TurnEvent } from "@/lib/ai/turn-events";
import { loadProjectScope } from "@/lib/canvas/project-scope";
import { recordActivity } from "@/lib/services/activity";
import { recordAudit } from "@/lib/services/audit";
import { readDirectionsSince } from "@/lib/services/directions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TurnRequestSchema, TURN_RATE_LIMIT } from "@/lib/validation/turns";

export const runtime = "nodejs";

function errorResponse(error: SafeError, status: number) {
  return NextResponse.json({ error }, { status });
}

function encodeEvent(event: TurnEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Conversation turn. Treated as a public mutation endpoint: authenticate,
 * authorise the project, validate input, rate-limit, then stream
 * (SECURITY_STANDARDS §8). Message bodies are never logged.
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

  // Ownership check in the service layer, with RLS underneath. A foreign or
  // nonexistent project produces the same 404 (no existence inference).
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
  const parsed = TurnRequestSchema.safeParse(payload);
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
      p_action: TURN_RATE_LIMIT.action,
      p_limit: TURN_RATE_LIMIT.limit,
      p_window_seconds: TURN_RATE_LIMIT.windowSeconds,
    })
    .single<{ allowed: boolean; retry_after_seconds: number }>();
  if (limitError) {
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage:
          "The message could not be sent right now. Your text is unchanged — try again.",
        recoverable: true,
      },
      503,
    );
  }
  if (!limit.allowed) {
    return errorResponse(
      {
        code: "rate_limited",
        userMessage: `You have sent a lot of messages in a short time. Wait ${limit.retry_after_seconds} seconds and send again — your text is unchanged.`,
        recoverable: true,
        retryAfterSeconds: limit.retry_after_seconds,
      },
      429,
    );
  }

  const turnId = crypto.randomUUID();
  const { error: insertError } = await supabase.from("messages").insert({
    project_id: projectId,
    turn_id: turnId,
    role: "user",
    content: parsed.data.message,
  });
  if (insertError) {
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage:
          "Your message could not be saved, so nothing was sent. Your text is unchanged — try again.",
        recoverable: true,
      },
      503,
    );
  }

  // The scene scope is read once, up front, under the caller's own client:
  // every id a scene may name comes from rows this user can already read.
  const scope = await loadProjectScope(supabase, projectId);
  await recordAudit(supabase, {
    projectId,
    actorId: user.id,
    actorKind: "user",
    action: "turn_started",
    correlationId: turnId,
  });

  const engine = new ScriptedDiscoveryEngine();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TurnEvent) => {
        controller.enqueue(encodeEvent(event));
      };
      /*
        Steering arrives on a separate request, so the turn reads directions
        newer than a cursor it advances itself. The table stays append-only:
        "already applied" is state of this run, not an edit to history.
      */
      let directionCursor = new Date().toISOString();
      const hooks = createTurnHooks({
        emit,
        scope,
        onActivity: (line) =>
          recordActivity(supabase, { projectId, turnId, line }),
        onSceneAccepted: (scene) =>
          recordAudit(supabase, {
            projectId,
            actorId: user.id,
            actorKind: "system",
            action: "scene_recommended",
            target: scene.renderer,
            correlationId: turnId,
            detail: { objects: scene.visibleObjectIds.length },
          }),
        onSceneRejected: (rejection) =>
          recordAudit(supabase, {
            projectId,
            actorId: user.id,
            actorKind: "system",
            action: "scene_rejected",
            correlationId: turnId,
            detail: { code: rejection.code },
          }),
        takeDirection: async () => {
          const directions = await readDirectionsSince(supabase, {
            projectId,
            turnId,
            after: directionCursor,
          });
          if (directions.length === 0) return null;
          directionCursor = directions[directions.length - 1].createdAt;
          const note = directions.map((entry) => entry.note).join("\n");
          emit({ type: "direction_applied", note });
          return note;
        },
      });

      try {
        const result = await engine.runTurn(
          {
            projectId,
            turnId,
            userMessage: parsed.data.message,
            context: { objectIds: [...scope.objectIds] },
          },
          hooks,
          request.signal,
        );
        if (result.assistantText) {
          await supabase.from("messages").insert({
            project_id: projectId,
            turn_id: turnId,
            role: "assistant",
            content: result.assistantText,
          });
        }
        await recordAudit(supabase, {
          projectId,
          actorId: user.id,
          actorKind: "system",
          action: result.assistantText ? "turn_completed" : "turn_failed",
          correlationId: turnId,
        });
      } catch {
        // Internal detail stays server-side (SECURITY_STANDARDS §8).
        emit({
          type: "turn_failed",
          error: {
            code: "engine_unavailable",
            userMessage:
              "The response could not be completed. Your message is saved — send another when you are ready.",
            recoverable: true,
          },
        });
        await recordAudit(supabase, {
          projectId,
          actorId: user.id,
          actorKind: "system",
          action: "turn_failed",
          correlationId: turnId,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
