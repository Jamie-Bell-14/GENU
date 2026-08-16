import type Anthropic from "@anthropic-ai/sdk";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationStream } from "@/components/conversation/conversation-stream";
import { LivingCanvas } from "@/components/canvas/living-canvas";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectScope } from "@/lib/canvas/scene";
import type { ResearchEvent, ResearchProvider } from "@/lib/research/types";
import { commitTurn } from "@/lib/services/model-operations";
import type { CompleteTurnRecord } from "@/lib/services/trusted-writer";
import { AnthropicDiscoveryEngine } from "./anthropic-engine";
import { createActivityReporter } from "./activity-reporter";
import { finishTurn } from "./finish-turn";
import { createTurnHooks, type TurnPorts } from "./turn-hooks";
import {
  INITIAL_TURN_STATE,
  turnReducer,
  type TurnEvent,
  type TurnState,
} from "./turn-events";

/**
 * The Step 2–3 path on a **new** project, end to end through everything except
 * the provider (docs/VERTICAL_SLICE_SPEC.md Steps 2–3, T9 "Done when").
 *
 * The empty start is the point. An earlier version of this test began with an
 * existing concept and put the not-yet-written assumption's id in the scope, so
 * the model could name ids that only exist after the commit — a state the real
 * first turn cannot be in. That hid the transition this task actually has to
 * make work: no objects, no scene, no ids to name; then a commit that generates
 * ids; then a canvas that shows the sparse model *in the same turn*.
 *
 * A provider response shaped exactly as the live engine would receive one is
 * driven through the real hooks, the real validation boundary, the real commit
 * path, the real reducer and the real components.
 *
 * It does not prove the model behaves this way. Only a live smoke test can, and
 * this deliberately does not claim to replace one.
 */

const TURN = "dddddddd-0000-4000-8000-000000000001";
/** An id the model invents, because on an empty project it has none to name. */
const IMAGINED = "aaaaaaaa-0000-4000-8000-00000000dead";

const USER_MESSAGE =
  "Landlords and tenants argue about property condition at the end of a tenancy.";

/** A new project: nothing on the canvas, and no id a scene could name. */
const emptyScope: ProjectScope = {
  objectIds: new Set<string>(),
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
                rationale: "Drawn from what the person described.",
                // Provider-valid for an inference: the property is required by
                // the strict schema and null when there is nothing to quote.
                quotedFromMessage: null,
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
            quotedFromMessage: null,
          },
        },
        {
          /*
            The model reaching for a view of a project that has no objects yet.
            It can only guess an id, and the guess is refused — which is why the
            first turn's canvas has to come from the application's own default
            rather than from a recommendation.
          */
          type: "tool_use",
          id: "t3",
          name: "recommend_canvas_scene",
          input: {
            renderer: "problem_exploration",
            purpose: "explore_problem",
            focalObjectId: IMAGINED,
            visibleObjectIds: [IMAGINED],
            visibleRelationshipIds: [],
            emphasis: "none",
            reason: "Showing the problem you described.",
            transition: "replace",
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

/**
 * Stands in for `complete_turn`: it generates the ids the database would, so
 * nothing downstream can depend on an id being known before the commit.
 */
function scriptedCommit() {
  const stored: { objects: CanvasObject[] } = { objects: [] };
  const commit = async (writes: {
    assistantText: string;
    fields: unknown[];
    assumptions: unknown[];
  }): Promise<CompleteTurnRecord> => {
    const written: Record<string, number> = {};
    let n = 0;
    const id = () =>
      `bbbbbbbb-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
    for (const row of writes.fields as {
      slot: number;
      label: string;
      value: string;
      origin: string;
    }[]) {
      stored.objects.push({
        id: id(),
        kind: "concept",
        zone: "subject",
        title: row.value,
        origin: row.origin as CanvasObject["origin"],
      });
      written[String(row.slot)] = (written[String(row.slot)] ?? 0) + 1;
    }
    for (const row of writes.assumptions as {
      slot: number;
      statement: string;
      alternatives: string[];
      origin: string;
    }[]) {
      stored.objects.push({
        id: id(),
        kind: "assumption",
        zone: "assumptions",
        title: row.statement.replace(/\.$/, ""),
        origin: row.origin as CanvasObject["origin"],
        support: "hypothesis",
        alternatives: row.alternatives,
      });
      written[String(row.slot)] = (written[String(row.slot)] ?? 0) + 1;
    }
    return { outcome: "completed", written, refused: {}, proposals: {} };
  };
  return { commit, stored };
}

describe("a live-shaped Step 2–3 turn reaches the screen", () => {
  it("starts an empty project, records a field and an assumption, and shows them in the same turn", async () => {
    const events: TurnEvent[] = [];
    const rejections: string[] = [];
    const order: string[] = [];

    const emit = (event: TurnEvent) => events.push(event);
    const reporter = createActivityReporter({
      emit,
      persist: async () => {},
    });

    const hooks = createTurnHooks({
      emit,
      scope: emptyScope,
      reporter,
      onSceneAccepted: async () => {
        throw new Error("an empty project has no id a scene could name");
      },
      onSceneRejected: async (rejection) => {
        rejections.push(rejection.code);
      },
      takeDirection: async () => null,
      onDirectionApplied: () => {},
      turnId: TURN,
      researchProvider: {
        start: () => ({ id: "unused" }),
        steer: () => "requires_restart",
        stop: () => {},
      },
      recordResearchFinding: async () => null,
    });

    const provider = scriptedProvider();
    const engine = new AnthropicDiscoveryEngine({ client: provider.client });
    const result = await engine.runTurn(
      {
        projectId: "p1",
        turnId: TURN,
        userMessage: USER_MESSAGE,
        // Nothing to name: this is the real shape of a first turn.
        context: { objectIds: [], focalObjectId: null },
      },
      hooks,
      undefined,
    );

    const committer = scriptedCommit();

    /*
      The host's durable boundary, exactly as the route wires it: one commit
      carrying the answer, the staged writes and the terminal state — then, and
      only then, the canvas is told what the project holds, re-read from the
      rows that commit created.
    */
    await finishTurn(
      {
        turnId: TURN,
        completeTurn: (assistantText) => {
          order.push("commit");
          return commitTurn(
            committer.commit,
            { projectId: "p1", turnId: TURN, userMessage: USER_MESSAGE },
            result.operations,
            assistantText,
          );
        },
        publishProjectModel: async () => {
          order.push("publish");
          emit({
            type: "project_model_updated",
            objects: committer.stored.objects,
            relationships: [],
          });
        },
        closeRun: async () => {
          order.push("close");
          return true;
        },
        audit: async () => {},
        auditOperation: async () => {},
        emit,
      },
      result.assistantText,
    );

    // 1. One commit, then the canvas. Nothing was closed separately, because
    //    the terminal state is inside that commit.
    expect(order).toEqual(["commit", "publish"]);

    // 2. The model's guessed scene never reached the canvas.
    expect(rejections).toEqual(["object_not_in_project"]);
    expect(events.some((event) => event.type === "scene_recommended")).toBe(
      false,
    );

    // 3. Both project-truth writes landed, with ids the commit generated.
    expect(committer.stored.objects.map((object) => object.kind)).toEqual([
      "concept",
      "assumption",
    ]);
    expect(
      committer.stored.objects.every((object) => object.id.startsWith("bbbb")),
    ).toBe(true);

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
      5. The canvas draws the new model in the *default visual view*, during the
      same turn — the transition an empty project has to make and the one the
      earlier fabricated scope hid. The scene is the application's own derived
      default: the model never predicted these ids and could not have.
    */
    expect(state.projectModel?.objects).toEqual(committer.stored.objects);
    const canvas = render(
      <LivingCanvas
        objects={state.projectModel?.objects ?? []}
        relationships={[]}
        recommendedScene={state.recommendedScene}
        activity={null}
        onEdit={vi.fn()}
      />,
    );

    expect(
      within(canvas.container).queryByText(/No focus is selected/),
    ).not.toBeInTheDocument();
    expect(
      within(canvas.container).getByText(
        /Condition disputes surface at the end of a tenancy/,
      ),
    ).toBeInTheDocument();

    /*
      And the assumption arrives with its meaning attached, not merely present:
      the support state and the alternatives are what make an assumption on the
      canvas honest rather than decorative (Step 3 acceptance). Read in the
      structured view, which is the application-owned inspector of what the
      project now contains.
    */
    await userEvent.click(
      within(canvas.container).getByText("Structured view"),
    );
    expect(
      within(canvas.container).getByText("Smaller agencies feel this most"),
    ).toBeInTheDocument();
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

/**
 * Same-turn "Research this" → "Add as evidence" (T10 review round 4, P0-1).
 *
 * Driven through the real engine, the real hooks and the real `commitTurn`
 * — not a direct RPC call naming a receipt the application never actually
 * produced — because the defect the review found was in the *wiring*
 * between them: `route.ts` observing `research_started` and clearing a
 * stale `activeFindingId` before it ever reaches `commitTurn`, which a test
 * that starts from a hand-picked `activeFindingId` cannot exercise.
 */
describe("same-turn research and add-evidence are never wired together (T10 review round 4, P0-1)", () => {
  const FOCAL = "aaaaaaaa-0000-4000-8000-000000000001";
  const RESEARCH_TURN = "dddddddd-0000-4000-8000-000000000002";

  const scope: ProjectScope = {
    objectIds: new Set([FOCAL]),
    relationshipIds: new Set(),
  };

  /** Emits its whole pass synchronously — nothing here exercises steering. */
  function fakeResearchProvider(): ResearchProvider {
    return {
      start: (_task, onEvent: (event: ResearchEvent) => void) => {
        onEvent({ type: "step", step: "searching_sources" });
        onEvent({
          type: "finding",
          finding: {
            id: "provider-side-id",
            title: "Fresh finding from this turn",
            keyFinding: "Something new.",
            whyItMatters: "It matters.",
            visualisation: { kind: "bar", unit: "%", series: [] },
            sources: [],
            methodology: "Method.",
            limitations: "Limits.",
            retrievedAt: "2026-08-02T00:00:00.000Z",
            isDemo: true,
            conflicting: false,
          },
        });
        onEvent({ type: "done" });
        return { id: "fake-handle" };
      },
      steer: () => "requires_restart",
      stop: () => {},
    };
  }

  function scriptedTurns(): { client: Anthropic; requests: unknown[] } {
    const requests: unknown[] = [];
    let call = 0;
    const turns: { content: unknown[]; stop_reason: string }[] = [
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "start_research",
            input: { topic: "Deposit disputes" },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "add_evidence",
            input: {
              consequenceSummary: "It bears on the target somehow.",
              direction: "unclear",
            },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Done for now." }],
        stop_reason: "end_turn",
      },
    ];
    const client = {
      messages: {
        stream(params: unknown) {
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

  /**
   * Runs the turn exactly as `route.ts` wires it: an `emit` wrapper that
   * observes `research_started` to decide whether the request's own
   * `activeFindingId` may still be trusted, feeding that decision into the
   * same `commitTurn` production code uses.
   */
  async function runSameTurnScenario(requestActiveFindingId: string | null) {
    const events: TurnEvent[] = [];
    let researchRanThisTurn = false;
    const emit = (event: TurnEvent) => {
      if (event.type === "research_started") researchRanThisTurn = true;
      events.push(event);
    };
    const reporter = createActivityReporter({ emit, persist: async () => {} });

    const hooks = createTurnHooks({
      emit,
      scope,
      reporter,
      onSceneAccepted: async () => {},
      onSceneRejected: async () => {},
      takeDirection: async () => null,
      onDirectionApplied: () => {},
      turnId: RESEARCH_TURN,
      researchProvider: fakeResearchProvider(),
      recordResearchFinding: async () => "fresh-receipt-id",
    } satisfies TurnPorts);

    const stub = scriptedTurns();
    const engine = new AnthropicDiscoveryEngine({ client: stub.client });
    const result = await engine.runTurn(
      {
        projectId: "p1",
        turnId: RESEARCH_TURN,
        userMessage: "Research this and add it as evidence.",
        context: { objectIds: [FOCAL], focalObjectId: FOCAL },
      },
      hooks,
      undefined,
    );

    const committerCalls: unknown[] = [];
    const commit = async (writes: {
      assistantText: string;
      fields: unknown[];
      assumptions: unknown[];
      evidence: unknown[];
    }): Promise<CompleteTurnRecord> => {
      committerCalls.push(writes.evidence);
      // Nothing here ever legitimately reaches the committer with an
      // `add_evidence` row in either scenario below — see the assertions.
      return { outcome: "completed", written: {}, refused: {}, proposals: {} };
    };

    await finishTurn(
      {
        turnId: RESEARCH_TURN,
        completeTurn: (assistantText) =>
          commitTurn(
            commit,
            {
              projectId: "p1",
              turnId: RESEARCH_TURN,
              userMessage: "Research this and add it as evidence.",
              /*
                Cleared whenever this turn ran its own research
                (T10 review round 4, P0-1) — exactly the check `route.ts`
                performs, reproduced here rather than re-implemented, so
                this test proves the same wiring production uses.
              */
              activeFindingId: researchRanThisTurn
                ? null
                : requestActiveFindingId,
            },
            result.operations,
            assistantText,
          ),
        publishProjectModel: async () => {},
        closeRun: async () => true,
        audit: async () => {},
        auditOperation: async () => {},
        emit,
      },
      result.assistantText,
    );

    return { events, committerCalls };
  }

  it("with no previous receipt: start_research then add_evidence is refused, never bound to nothing", async () => {
    const { events, committerCalls } = await runSameTurnScenario(null);

    // The refusal is real and durable, not merely swallowed.
    expect(events).toContainEqual(
      expect.objectContaining({ type: "evidence_refused" }),
    );
    // Nothing was ever staged as a write the committer could act on.
    expect(
      committerCalls.every((evidence) => (evidence as unknown[]).length === 0),
    ).toBe(true);
  });

  it("with an older receipt active: research produces a new finding, and add_evidence must never write the old one", async () => {
    const { events, committerCalls } = await runSameTurnScenario(
      "stale-receipt-from-before-this-turn",
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: "evidence_refused" }),
    );
    // Specifically: the stale id from before this turn began never reaches
    // the committer at all — the whole operation is refused before that,
    // exactly as it is when there was no receipt to begin with.
    expect(
      committerCalls.every((evidence) => (evidence as unknown[]).length === 0),
    ).toBe(true);
  });
});
