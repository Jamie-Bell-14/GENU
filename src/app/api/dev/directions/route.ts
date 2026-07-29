import { NextResponse, type NextRequest } from "next/server";
import { ScriptedDiscoveryEngine } from "@/lib/ai/discovery-engine";
import { DIRECTION_APPLICATION_MESSAGES } from "@/lib/ai/turn-events";
import { addPendingDirection } from "@/lib/dev/pending-directions";
import { DirectionRequestSchema } from "@/lib/services/directions";

export const runtime = "nodejs";

/**
 * Development-only counterpart to the project direction endpoint. Same
 * validation and same promised application mode; the handover is module state
 * rather than the database because this route has none. 404 in production.
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
  const parsed = DirectionRequestSchema.safeParse(payload);
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

  // A direction must belong to a turn this endpoint actually started, the
  // dev-route equivalent of the real route's ownership check.
  if (!addPendingDirection(parsed.data.turnId, parsed.data.note)) {
    return NextResponse.json(
      {
        error: {
          code: "engine_unavailable",
          userMessage:
            "That turn is no longer running, so the direction was not recorded. Your text is unchanged.",
          recoverable: true,
        },
      },
      { status: 404 },
    );
  }

  const application = new ScriptedDiscoveryEngine().directionApplication;
  return NextResponse.json({
    application,
    message: DIRECTION_APPLICATION_MESSAGES[application],
  });
}
