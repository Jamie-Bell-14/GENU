import { NextResponse, type NextRequest } from "next/server";
import { ScriptedDiscoveryEngine } from "@/lib/ai/discovery-engine";
import type { SafeError, TurnEvent } from "@/lib/ai/turn-events";
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

  const engine = new ScriptedDiscoveryEngine();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TurnEvent) => {
        controller.enqueue(encodeEvent(event));
      };
      try {
        const result = await engine.runTurn(
          { projectId, userMessage: parsed.data.message },
          emit,
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
