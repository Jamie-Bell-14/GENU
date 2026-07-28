import { NextResponse, type NextRequest } from "next/server";
import { ScriptedDiscoveryEngine } from "@/lib/ai/discovery-engine";
import type { TurnEvent } from "@/lib/ai/turn-events";
import { TurnRequestSchema } from "@/lib/validation/turns";

export const runtime = "nodejs";

/**
 * Development-only turn endpoint: the same scripted engine and event stream
 * as the real route, without a database or session. It persists nothing and
 * is unavailable in production, so it cannot become a bypass.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const parsed = TurnRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "message_too_long",
          userMessage: parsed.error.issues[0].message,
          recoverable: true,
        },
      },
      { status: 400 },
    );
  }

  const engine = new ScriptedDiscoveryEngine();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TurnEvent) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      await engine.runTurn(
        { projectId: "demo", userMessage: parsed.data.message },
        emit,
        request.signal,
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
    },
  });
}
