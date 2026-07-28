import { NextResponse, type NextRequest } from "next/server";
import { ScriptedDiscoveryEngine } from "@/lib/ai/discovery-engine";
import { createTurnHooks } from "@/lib/ai/turn-hooks";
import type { TurnEvent } from "@/lib/ai/turn-events";
import { DEMO_OBJECTS, DEMO_RELATIONSHIPS } from "@/lib/dev/demo-project";
import { takePendingDirections } from "@/lib/dev/pending-directions";
import { TurnRequestSchema } from "@/lib/validation/turns";

export const runtime = "nodejs";

/**
 * Development-only turn endpoint: the same scripted engine, event stream and
 * scene-validation boundary as the real route, without a database or session.
 * It persists nothing and is unavailable in production, so it cannot become a
 * bypass — including of scene validation, which runs here against the demo
 * model exactly as it runs against a real project's ids.
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

  const objectIds = DEMO_OBJECTS.map((object) => object.id);
  const scope = {
    objectIds: new Set(objectIds),
    relationshipIds: new Set(
      DEMO_RELATIONSHIPS.map((relationship) => relationship.id),
    ),
  };

  const turnId = crypto.randomUUID();
  // A small per-chunk delay so the observable behaviours this route exists to
  // demonstrate — activity, steering, stopping — are actually observable.
  const engine = new ScriptedDiscoveryEngine(150);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TurnEvent) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      const hooks = createTurnHooks({
        emit,
        scope,
        // No database here: activity is streamed and shown, not stored.
        onActivity: async () => {},
        onSceneAccepted: async () => {},
        onSceneRejected: async () => {},
        takeDirection: async () => {
          const note = takePendingDirections(turnId);
          if (note) emit({ type: "direction_applied", note });
          return note;
        },
      });

      await engine.runTurn(
        {
          projectId: "demo",
          turnId,
          userMessage: parsed.data.message,
          context: { objectIds },
        },
        hooks,
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
