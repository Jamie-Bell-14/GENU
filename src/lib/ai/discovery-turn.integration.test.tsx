import type Anthropic from "@anthropic-ai/sdk";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationStream } from "@/components/conversation/conversation-stream";
import { LivingCanvas } from "@/components/canvas/living-canvas";
import type { CanvasObject } from "@/lib/canvas/model";
import { validateScene, type ProjectScope } from "@/lib/canvas/scene";
import { AnthropicDiscoveryEngine } from "./anthropic-engine";
import { createActivityReporter } from "./activity-reporter";
import { finishTurn } from "./finish-turn";
import { createTurnHooks } from "./turn-hooks";
import {
  INITIAL_TURN_STATE,
  turnReducer,
  type TurnEvent,
  type TurnState,
} from "./turn-events";

/**
 * The Step 2–3 path, end to end through everything except the provider
 * (docs/VERTICAL_SLICE_SPEC.md Steps 2–3, T9 "Done when").
 *
 * A provider response shaped exactly as the live engine would receive one is
 * driven through the real hooks, the real validation boundary, the real
 * reducer and the real components. What it proves is the join: that a turn
 * which records a field, records an assumption, recommends a scene and offers
 * actions actually reaches the screen — the three gaps GPT found were each a
 * missing *connection* rather than a missing part, and only a test that spans
 * the whole path can catch that class of defect.
 *
 * It does not prove the model behaves this way. Only a live smoke test can, and
 * this deliberately does not claim to replace one.
 */

const TURN = "dddddddd-0000-4000-8000-000000000001";
const CONCEPT = "aaaaaaaa-0000-4000-8000-000000000001";
const ASSUMPTION_OBJECT = "aaaaaaaa-0000-4000-8000-000000000002";

const USER_MESSAGE =
  "Landlords and tenants argue about property condition at the end of a tenancy.";

/** What the canvas holds before the turn: the sparse Step 2 starting point. */
const objectsBefore: CanvasObject[] = [
  {
    id: CONCEPT,
    kind: "concept",
    zone: "subject",
    title: "Property-condition disagreement",
    origin: "user_stated",
  },
];

/** What the server re-reads after the turn's writes land. */
const objectsAfter: CanvasObject[] = [
  ...objectsBefore,
  {
    id: ASSUMPTION_OBJECT,
    kind: "assumption",
    zone: "assumptions",
    title: "Smaller agencies feel this most",
    origin: "user_stated",
    support: "hypothesis",
    alternatives: ["Larger agencies have more disputes by volume."],
  },
];

const scope: ProjectScope = {
  objectIds: new Set([CONCEPT, ASSUMPTION_OBJECT]),
  relationshipIds: new Set<string>(),
};

/** One provider response carrying everything a Step 2–3 turn would do. */
function scriptedProvider() {
  const requests: unknown[] = [];
  let call = 0;
  const turns: { content: unknown[]; stop_reason: string }[] = [
    {
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "update_project_model",
          input: {
            updates: [
              {
                area: "problem",
                key: "primary_pain",
                label: "Primary pain",
                value: "Condition disputes surface at the end of a tenancy.",
                origin: "ai_inferred",
                support: "hypothesis",
                rationale: "Stated by the person in their own words.",
                quotedFromMessage: "at the end of a tenancy",
              },
            ],
          },
        },
        {
          type: "tool_use",
          id: "t2",
          name: "record_assumption",
          input: {
            statement: "Smaller agencies feel this most.",
            whyItMatters: "It decides who the first customer is.",
            alternatives: ["Larger agencies have more disputes by volume."],
            importance: "material",
          },
        },
        {
          type: "tool_use",
          id: "t3",
          name: "recommend_canvas_scene",
          input: {
            renderer: "problem_exploration",
            purpose: "explore_problem",
            focalObjectId: CONCEPT,
            visibleObjectIds: [CONCEPT, ASSUMPTION_OBJECT],
            visibleRelationshipIds: [],
            emphasis: "none",
            reason: "Showing the problem and the assumption it now rests on.",
            transition: "augment",
          },
        },
        {
          type: "tool_use",
          id: "t4",
          name: "suggest_actions",
          input: { actionIds: ["explain_reasoning", "challenge_this"] },
        },
      ],
      stop_reason: "tool_use",
    },
    {
      content: [
        {
          type: "text",
          text: "You have described a dispute at tenancy end. Which side raises it first?",
        },
      ],
      stop_reason: "end_turn",
    },
  ];

  const client = {
    messages: {
      stream(params: unknown) {
        /*
          Cloned, not referenced. The engine mutates its `messages` array across
          rounds, so a stored reference would show the final transcript for
          every request and make a per-request assertion meaningless.
        */
        requests.push(JSON.parse(JSON.stringify(params)));
        const turn = turns[Math.min(call, turns.length - 1)];
        call += 1;
        return {
          async *[Symbol.asyncIterator]() {
            for (const [index, block] of turn.content.entries()) {
              const typed = block as { type: string; text?: string };
              if (typed.type === "text") {
                yield {
                  type: "content_block_delta",
                  index,
                  delta: { type: "text_delta", text: typed.text },
                };
              }
            }
          },
          finalMessage: async () =>
            ({
              ...turn,
              usage: { input_tokens: 100, output_tokens: 100 },
            }) as unknown as Anthropic.Message,
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

describe("a live-shaped Step 2–3 turn reaches the screen", () => {
  it("records a field and an assumption, refreshes the canvas, shows the scene and the actions", async () => {
    const events: TurnEvent[] = [];
    /** What the host applied, and in what order relative to the answer. */
    const applied: { name: string; candidate: unknown }[] = [];
    const order: string[] = [];

    const emit = (event: TurnEvent) => events.push(event);
    const reporter = createActivityReporter({
      emit,
      persist: async () => {},
    });

    const hooks = createTurnHooks({
      emit,
      scope,
      reporter,
      onSceneAccepted: async () => {},
      onSceneRejected: async () => {
        throw new Error("the scene should have been accepted");
      },
      takeDirection: async () => null,
      onDirectionApplied: () => {},
    });

    const provider = scriptedProvider();
    const engine = new AnthropicDiscoveryEngine({ client: provider.client });
    const result = await engine.runTurn(
      {
        projectId: "p1",
        turnId: TURN,
        userMessage: USER_MESSAGE,
        context: {
          objectIds: [CONCEPT, ASSUMPTION_OBJECT],
          focalObjectId: CONCEPT,
        },
      },
      hooks,
      undefined,
    );

    /*
      The host's durable boundary, exactly as the route orders it: the answer is
      stored, the staged operations are applied as one unit, the turn is closed
      and only then is the canvas told what the project now holds. The engine
      never describes what the canvas shows — the application re-reads it.
    */
    await finishTurn(
      {
        persistResult: async () => {
          order.push("persist");
          return true;
        },
        applyOperations: async () => {
          order.push("apply");
          applied.push(...result.operations);
          return result.operations.length > 0;
        },
        publishProjectModel: async () => {
          order.push("publish");
          emit({
            type: "project_model_updated",
            objects: objectsAfter,
            relationships: [],
          });
        },
        closeRun: async () => {
          order.push("close");
          return true;
        },
        audit: async () => {},
        emit,
      },
      result.assistantText,
    );

    // 1. The model was given the ids it needs to name an existing object.
    const firstRequest = provider.requests[0] as {
      messages: { content: string }[];
    };
    expect(firstRequest.messages.at(-1)?.content).toContain(CONCEPT);

    // 2. Both project-truth operations were applied, once, after the answer was
    //    stored — and neither during the turn.
    expect(applied.map((operation) => operation.name)).toEqual([
      "update_project_model",
      "record_assumption",
    ]);
    expect(order).toEqual(["persist", "apply", "close", "publish"]);

    // 3. The scene survived validation against the project's real ids.
    const scene = events.find((event) => event.type === "scene_recommended");
    expect(scene).toBeDefined();
    if (scene?.type === "scene_recommended") {
      expect(validateScene(scene.scene, scope).ok).toBe(true);
    }

    // 4. Everything the user should see is on the stream.
    let state: TurnState = INITIAL_TURN_STATE;
    state = turnReducer(state, {
      type: "user_message_sent",
      message: {
        id: "m1",
        turnId: TURN,
        role: "user",
        content: USER_MESSAGE,
        blockKind: "plain",
        createdAt: "2026-07-29T00:00:00.000Z",
      },
    });
    state = turnReducer(state, {
      type: "event",
      event: { type: "turn_started", turnId: TURN },
    });
    // Including everything the host emitted at its durable boundary: the
    // refreshed model and `done` are on the same stream the client reads.
    for (const event of events) {
      state = turnReducer(state, { type: "event", event });
    }

    expect(result.assistantText).toContain("Which side raises it first?");

    // The reflection and the focused question render.
    const conversation = render(<ConversationStream state={state} />);
    expect(
      within(conversation.container).getByText(/Which side raises it first\?/),
    ).toBeInTheDocument();

    // Contextual actions came from the application's catalogue, capped at three.
    expect(state.actions.map((action) => action.label)).toEqual([
      "Explain my reasoning",
      "Challenge this",
    ]);
    expect(state.actions.length).toBeLessThanOrEqual(3);

    /*
      5. The canvas draws the refreshed model, so the assumption is visible in
      the same turn rather than after a reload. This is the assertion the three
      earlier gaps would each have failed.
    */
    expect(state.projectModel?.objects).toEqual(objectsAfter);
    const canvas = render(
      <LivingCanvas
        objects={state.projectModel?.objects ?? objectsBefore}
        relationships={[]}
        recommendedScene={state.recommendedScene}
        activity={null}
        onEdit={vi.fn()}
      />,
    );

    /*
      The recommended scene is *offered*, not applied — the user chooses
      (docs/AI_SYSTEM.md §9.3), which is why the visual view asks rather than
      rearranging. So the assertion that the canvas really holds the new
      assumption is made against the structured view, which is the
      application-owned inspector of what the project now contains.
    */
    expect(
      within(canvas.container).getByText(/Showing the problem/),
    ).toBeInTheDocument();
    expect(
      within(canvas.container).getByRole("button", { name: /Show it/ }),
    ).toBeInTheDocument();

    // The switcher is a toggle group; clicking the labelled control is what a
    // user does, whatever role the primitive reports.
    await userEvent.click(
      within(canvas.container).getByText("Structured view"),
    );
    expect(
      within(canvas.container).getByText("Smaller agencies feel this most"),
    ).toBeInTheDocument();
    /*
      And it arrives with its meaning attached, not merely present: the support
      state and the alternatives are what make an assumption on the canvas
      honest rather than decorative (Step 3 acceptance).
    */
    expect(
      within(canvas.container).getByText(/Hypothesis/),
    ).toBeInTheDocument();
    expect(
      within(canvas.container).getByText(
        /Larger agencies have more disputes by volume/,
      ),
    ).toBeInTheDocument();
  });
});
