import { NextResponse, type NextRequest } from "next/server";
import { createActivityReporter } from "@/lib/ai/activity-reporter";
import { ScriptedDiscoveryEngine } from "@/lib/ai/discovery-engine";
import { createTurnHooks } from "@/lib/ai/turn-hooks";
import type { TurnEvent } from "@/lib/ai/turn-events";
import { defaultFocalObjectId } from "@/lib/canvas/problem-map";
import { DEMO_OBJECTS, DEMO_RELATIONSHIPS } from "@/lib/dev/demo-project";
import {
  closeDevTurn,
  openDevTurn,
  takePendingDirections,
} from "@/lib/dev/pending-directions";
import { TurnRequestSchema } from "@/lib/validation/turns";

export const runtime = "nodejs";

/*
  A per-chunk delay so the behaviours this route exists to demonstrate —
  activity, steering, stopping — can actually be seen and driven. It simulates
  a model's pace, which is what the parameter has always been for; correctness
  does not depend on it, because the steering handoff itself is proved
  deterministically in src/app/api/dev/turns/route.test.ts.

  PPM_DEV_TURN_DELAY_MS overrides it, so the route-level tests can run the same
  code without waiting.
*/
function devChunkDelayMs(): number {
  const configured = Number(process.env.PPM_DEV_TURN_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 250;
}

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

  const turnId = crypto.randomUUID();
  openDevTurn(turnId);
  const engine = new ScriptedDiscoveryEngine(devChunkDelayMs());
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Best-effort, as in the real route: a departed reader must not stop the
      // turn finishing its own work.
      const emit = (event: TurnEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // The reader is gone.
        }
      };
      /*
        The turn id is the first thing on the stream, before any activity: the
        client needs it to steer the turn and to ask for catch-up if the
        connection drops, so it must not arrive after work has begun.
      */
      emit({ type: "turn_started", turnId });

      const reporter = createActivityReporter({
        emit,
        // No database here: activity is streamed and shown, not stored.
        persist: async () => {},
      });
      // The same operation the real route performs, on the demo model: read
      // what exists and work out what this project is exploring.
      const { objectIds, scope, focalObjectId } = await reporter.step(
        "reading_project_model",
        async () => ({
          objectIds: DEMO_OBJECTS.map((object) => object.id),
          scope: {
            objectIds: new Set(DEMO_OBJECTS.map((object) => object.id)),
            relationshipIds: new Set(
              DEMO_RELATIONSHIPS.map((relationship) => relationship.id),
            ),
          },
          focalObjectId: defaultFocalObjectId(DEMO_OBJECTS, DEMO_RELATIONSHIPS),
        }),
      );

      const hooks = createTurnHooks({
        emit,
        scope,
        reporter,
        onSceneAccepted: async () => {},
        onSceneRejected: async () => {},
        takeDirection: async ({ final }) =>
          takePendingDirections(turnId, { seal: final }),
        // Announced when the engine has actually used it, not when a note
        // merely exists — the same rule as the real route.
        onDirectionApplied: (note) => emit({ type: "direction_applied", note }),
      });

      try {
        const result = await engine.runTurn(
          {
            projectId: "demo",
            turnId,
            userMessage: parsed.data.message,
            context: { objectIds, focalObjectId },
          },
          hooks,
          request.signal,
        );
        // The host owns `done`. Nothing is persisted here, so it follows the
        // engine returning a result.
        if (result.assistantText) emit({ type: "done" });
      } finally {
        // The turn is over, so it can no longer take direction. Without this
        // the endpoint would keep accepting steering for a finished turn.
        closeDevTurn(turnId);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-turn-id": turnId,
    },
  });
}
