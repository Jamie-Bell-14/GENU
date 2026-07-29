import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  openDevTurn,
  resetDevTurns,
  takePendingDirections,
} from "@/lib/dev/pending-directions";
import type { TurnEvent } from "@/lib/ai/turn-events";
import { POST as directionRoute } from "../directions/route";
import { POST as turnRoute } from "./route";

/**
 * The steering handoff, proved deterministically.
 *
 * The end-to-end test drives steering through a browser, which necessarily
 * involves timing. This does not: it starts a turn, reads until the turn id
 * arrives, posts a direction, and then continues reading. Whether the direction
 * is picked up is therefore a property of the handoff, not of how fast anything
 * ran.
 */

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Reads SSE frames until `predicate` is satisfied or the stream ends. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  events: TurnEvent[],
  predicate: (event: TurnEvent) => boolean,
): Promise<boolean> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return false;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim()) as TurnEvent;
      events.push(event);
      if (predicate(event)) return true;
    }
  }
}

async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  events: TurnEvent[],
) {
  await readUntil(reader, events, () => false);
}

beforeAll(() => {
  /*
    The dev route's streaming delay exists to make the behaviour watchable in a
    browser. These tests keep a small one: the turn's step boundary comes after
    the streamed text, so a few milliseconds per chunk leaves a window that an
    in-process POST cannot miss. Nothing about correctness rests on it — the
    boundary itself is proved without timing in the two tests below and in
    discovery-engine.test.ts.
  */
  process.env.PPM_DEV_TURN_DELAY_MS = "5";
});

beforeEach(() => {
  resetDevTurns();
});

describe("the direction handoff, without timing", () => {
  it("hands a recorded direction to the turn it names", async () => {
    const turnId = "aaaaaaaa-1111-4111-8111-111111111111";
    openDevTurn(turnId);

    const accepted = await directionRoute(
      post("http://localhost/api/dev/directions", {
        turnId,
        note: "Focus on smaller letting agencies.",
      }),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ application: "next_step" });

    // What the turn reads at its step boundary is exactly what was recorded.
    expect(takePendingDirections(turnId)).toBe(
      "Focus on smaller letting agencies.",
    );
    // And it is consumed once, not replayed at every later boundary.
    expect(takePendingDirections(turnId)).toBeNull();
  });

  it("refuses a direction once the window is sealed, before the turn closes", async () => {
    // The window closes at the final direction boundary, which is earlier than
    // the turn finishing. Between the two there is no step left to consume a
    // direction, so accepting one would promise a step that will never come.
    const turnId = "cccccccc-1111-4111-8111-111111111111";
    openDevTurn(turnId);
    takePendingDirections(turnId, { seal: true });

    const refused = await directionRoute(
      post("http://localhost/api/dev/directions", {
        turnId,
        note: "After the final boundary.",
      }),
    );
    expect(refused.status).toBe(404);
  });

  it("keeps directions for different turns apart", async () => {
    openDevTurn("aaaaaaaa-1111-4111-8111-111111111111");
    openDevTurn("bbbbbbbb-2222-4222-8222-222222222222");
    await directionRoute(
      post("http://localhost/api/dev/directions", {
        turnId: "aaaaaaaa-1111-4111-8111-111111111111",
        note: "Only for the first turn.",
      }),
    );

    expect(
      takePendingDirections("bbbbbbbb-2222-4222-8222-222222222222"),
    ).toBeNull();
    expect(takePendingDirections("aaaaaaaa-1111-4111-8111-111111111111")).toBe(
      "Only for the first turn.",
    );
  });
});

describe("dev turn and direction endpoints", () => {
  it("applies a direction added while the turn is still running", async () => {
    const response = await turnRoute(
      post("http://localhost/api/dev/turns", {
        message: "Tenants and landlords argue about property condition.",
      }),
    );
    const reader = response.body!.getReader();
    const events: TurnEvent[] = [];

    expect(
      await readUntil(reader, events, (event) => event.type === "turn_started"),
    ).toBe(true);
    const started = events.find((event) => event.type === "turn_started");
    const turnId = (started as { turnId: string }).turnId;

    const accepted = await directionRoute(
      post("http://localhost/api/dev/directions", {
        turnId,
        note: "Focus on smaller letting agencies.",
      }),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ application: "next_step" });

    await drain(reader, events);

    // The turn reports picking it up, and says so in the response text.
    expect(events).toContainEqual({
      type: "direction_applied",
      note: "Focus on smaller letting agencies.",
    });
    const text = events
      .filter((event) => event.type === "assistant_delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("Focus on smaller letting agencies.");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("reports the steps it performs, each one completed", async () => {
    const response = await turnRoute(
      post("http://localhost/api/dev/turns", { message: "A problem" }),
    );
    const events: TurnEvent[] = [];
    await drain(response.body!.getReader(), events);

    const activity = events
      .filter((event) => event.type === "activity")
      .map((event) => `${event.activity.step}:${event.activity.state}`);
    expect(activity).toContain("preparing_canvas_view:active");
    expect(activity).toContain("preparing_canvas_view:succeeded");
    for (const entry of activity.filter((line) => line.endsWith(":active"))) {
      expect(activity).toContain(entry.replace(":active", ":succeeded"));
    }
  });

  it("recommends a scene naming the demo project's problem", async () => {
    const response = await turnRoute(
      post("http://localhost/api/dev/turns", { message: "A problem" }),
    );
    const events: TurnEvent[] = [];
    await drain(response.body!.getReader(), events);

    const scene = events.find((event) => event.type === "scene_recommended");
    expect(scene).toMatchObject({
      scene: {
        renderer: "problem_exploration",
        focalObjectId: "22222222-2222-4222-8222-000000000001",
      },
    });
  });

  it("accepts direction while a turn is open and refuses it once closed", async () => {
    const response = await turnRoute(
      post("http://localhost/api/dev/turns", { message: "A problem" }),
    );
    const reader = response.body!.getReader();
    const events: TurnEvent[] = [];
    expect(
      await readUntil(reader, events, (event) => event.type === "turn_started"),
    ).toBe(true);
    const turnId = (
      events.find((event) => event.type === "turn_started") as {
        turnId: string;
      }
    ).turnId;

    const whileOpen = await directionRoute(
      post("http://localhost/api/dev/directions", {
        turnId,
        note: "While the turn is running.",
      }),
    );
    expect(whileOpen.status).toBe(200);

    await drain(reader, events);

    // The turn is finished, so there is no step left to consume a direction.
    const afterClose = await directionRoute(
      post("http://localhost/api/dev/directions", {
        turnId,
        note: "After the turn finished.",
      }),
    );
    expect(afterClose.status).toBe(404);
  });

  it("refuses a direction for a turn it never started", async () => {
    const refused = await directionRoute(
      post("http://localhost/api/dev/directions", {
        turnId: "99999999-9999-4999-8999-999999999999",
        note: "Steer somebody else's turn.",
      }),
    );
    expect(refused.status).toBe(404);
  });

  it("rejects an empty or over-long direction before recording anything", async () => {
    for (const note of ["", "x".repeat(1001)]) {
      const refused = await directionRoute(
        post("http://localhost/api/dev/directions", {
          turnId: "99999999-9999-4999-8999-999999999999",
          note,
        }),
      );
      expect(refused.status).toBe(400);
    }
  });
});
