import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import type { CanvasScene } from "@/lib/canvas/scene";
import type { ResearchFinding } from "@/lib/research/types";
import { LivingCanvas } from "./living-canvas";

const PROBLEM = "aaaaaaaa-0000-4000-8000-000000000001";
const CAUSE = "aaaaaaaa-0000-4000-8000-000000000002";
const CONSEQUENCE = "aaaaaaaa-0000-4000-8000-000000000003";

const objects: CanvasObject[] = [
  {
    id: PROBLEM,
    kind: "concept",
    zone: "subject",
    title: "Property-condition disagreement",
    detail: "Tenants and landlords disagree at tenancy end.",
    origin: "user_stated",
    support: "hypothesis",
  },
  {
    id: CAUSE,
    kind: "concept",
    zone: "related",
    title: "Missing check-in evidence",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: CONSEQUENCE,
    kind: "assumption",
    zone: "assumptions",
    title: "Deposit disputes follow",
    origin: "ai_inferred",
    support: "hypothesis",
  },
];

const relationships: ProjectRelationship[] = [
  {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    fromObjectId: CAUSE,
    toObjectId: PROBLEM,
    relation: "possible_cause_of",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    fromObjectId: CONSEQUENCE,
    toObjectId: PROBLEM,
    relation: "consequence_of",
    origin: "user_stated",
    support: "hypothesis",
  },
];

function renderCanvas(props = {}) {
  return render(
    <LivingCanvas objects={objects} relationships={relationships} {...props} />,
  );
}

describe("scene host states", () => {
  it("explains the sparse empty canvas rather than showing nothing", () => {
    render(<LivingCanvas objects={[]} />);
    expect(
      screen.getByText(/canvas fills in as the conversation goes on/i),
    ).toBeInTheDocument();
  });

  it("renders loading and failure states distinctly", () => {
    const { rerender } = render(<LivingCanvas objects={[]} loading />);
    expect(screen.getByText(/loading the project model/i)).toBeInTheDocument();

    rerender(
      <LivingCanvas
        objects={[]}
        error="The project model could not be loaded. The conversation still works."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The conversation still works.",
    );
  });
});

describe("representation switch", () => {
  it("offers an explicit visual/structured control and starts visual", () => {
    renderCanvas();
    expect(screen.getByRole("radio", { name: "Visual view" })).toBeChecked();
    expect(screen.getByLabelText("Object in focus")).toBeInTheDocument();
  });

  it("switches to the structured inspector and back", async () => {
    const user = userEvent.setup();
    renderCanvas();
    await user.click(screen.getByRole("radio", { name: "Structured view" }));
    expect(
      screen.getByRole("region", { name: "Current subject" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Visual view" }));
    expect(screen.getByLabelText("Object in focus")).toBeInTheDocument();
  });

  it("shows the same canonical objects in both representations", async () => {
    const user = userEvent.setup();
    renderCanvas();
    expect(
      screen.getAllByText("Property-condition disagreement").length,
    ).toBeGreaterThan(0);
    await user.click(screen.getByRole("radio", { name: "Structured view" }));
    expect(
      screen.getAllByText("Property-condition disagreement").length,
    ).toBeGreaterThan(0);
  });
});

describe("problem-exploration renderer", () => {
  it("focuses the active problem and groups relationships into branches", () => {
    renderCanvas();
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Property-condition disagreement",
    );
    expect(
      screen.getByRole("region", { name: "Possible causes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Consequences" }),
    ).toBeInTheDocument();
  });

  it("renders no branches when no relationships are stored", () => {
    render(<LivingCanvas objects={objects} relationships={[]} />);
    expect(
      screen.getByText(/No relationships have been recorded/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Possible causes" }),
    ).not.toBeInTheDocument();
  });

  it("keeps origin and support visible on related objects", () => {
    renderCanvas();
    const causes = screen.getByRole("region", { name: "Possible causes" });
    expect(within(causes).getByText("Inferred")).toBeInTheDocument();
    expect(within(causes).getByText("Unexplored")).toBeInTheDocument();
    // Relationship provenance is distinct from the object's own origin.
    expect(within(causes).getByText("Link inferred")).toBeInTheDocument();
  });

  it("collapses a branch from the keyboard", async () => {
    const user = userEvent.setup();
    renderCanvas();
    const causes = screen.getByRole("region", { name: "Possible causes" });
    const toggle = within(causes).getByRole("button", { name: "Collapse" });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(
      within(causes).queryByText("Missing check-in evidence"),
    ).not.toBeInTheDocument();
    await user.click(within(causes).getByRole("button", { name: "Expand" }));
    expect(
      within(causes).getByText("Missing check-in evidence"),
    ).toBeInTheDocument();
  });

  it("hides a related object and reports the count", async () => {
    const user = userEvent.setup();
    renderCanvas();
    const causes = screen.getByRole("region", { name: "Possible causes" });
    await user.click(
      within(causes).getByLabelText("Hide Missing check-in evidence"),
    );
    expect(within(causes).getByText(/1 hidden/)).toBeInTheDocument();
  });

  it("refocuses on a related object and returns to the previous scene", async () => {
    const user = userEvent.setup();
    renderCanvas();
    await user.click(
      screen.getByLabelText("Focus on Missing check-in evidence"),
    );
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Missing check-in evidence",
    );

    await user.click(
      screen.getByRole("button", { name: "Return to previous" }),
    );
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Property-condition disagreement",
    );
  });

  it("hands an object from the inspector to the map", async () => {
    const user = userEvent.setup();
    renderCanvas();
    await user.click(screen.getByRole("radio", { name: "Structured view" }));
    const assumptions = screen.getByRole("region", { name: "Assumptions" });
    await user.click(
      within(assumptions).getByLabelText(
        "Show Deposit disputes follow in the relationship map",
      ),
    );
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Deposit disputes follow",
    );
  });

  it("reports objects that are not connected to the current focus", () => {
    render(
      <LivingCanvas objects={objects} relationships={[relationships[0]]} />,
    );
    expect(
      screen.getByText(/not\s+connected to this focus/i),
    ).toBeInTheDocument();
  });
});

describe("recommended scenes", () => {
  const recommendation: CanvasScene = {
    renderer: "problem_exploration",
    purpose: "explore_problem",
    focalObjectId: CAUSE,
    visibleObjectIds: [CAUSE, PROBLEM],
    visibleRelationshipIds: ["bbbbbbbb-0000-4000-8000-000000000001"],
    emphasis: "none",
    reason: "The conversation moved to missing check-in evidence.",
    transition: "replace",
  };

  // `recommendedScene` carries the id of the turn that produced it (issue
  // #13, T10 exit gate); tests default to a fixed turn unless they need a
  // different one.
  function withTurn(
    scene: CanvasScene,
    turnId = "dddddddd-0000-4000-8000-000000000001",
  ) {
    return { scene, turnId };
  }

  it("queues a recommendation with its reason instead of moving the view", () => {
    renderCanvas({ recommendedScene: withTurn(recommendation) });

    expect(
      screen.getByText(/The conversation moved to missing check-in evidence/),
    ).toBeInTheDocument();
    // The view the user was reading is untouched until they accept.
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Property-condition disagreement",
    );
  });

  it("applies the recommendation only when the user takes it", async () => {
    const user = userEvent.setup();
    renderCanvas({ recommendedScene: withTurn(recommendation) });

    await user.click(screen.getByRole("button", { name: "Show it" }));
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Missing check-in evidence",
    );
  });

  it("lets the user decline and stay where they are", async () => {
    const user = userEvent.setup();
    renderCanvas({ recommendedScene: withTurn(recommendation) });

    await user.click(screen.getByRole("button", { name: "Stay here" }));
    expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Property-condition disagreement",
    );
  });

  it("returns to the previous scene after accepting one", async () => {
    const user = userEvent.setup();
    renderCanvas({ recommendedScene: withTurn(recommendation) });

    await user.click(screen.getByRole("button", { name: "Show it" }));
    await user.click(
      screen.getByRole("button", { name: "Return to previous" }),
    );
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Property-condition disagreement",
    );
  });

  it("refuses a scene naming an object this canvas did not render", () => {
    renderCanvas({
      recommendedScene: withTurn({
        ...recommendation,
        focalObjectId: "eeeeeeee-0000-4000-8000-000000000009",
        visibleObjectIds: ["eeeeeeee-0000-4000-8000-000000000009"],
        visibleRelationshipIds: [],
      }),
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /outside this project.*current view is unchanged/i,
    );
    expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Property-condition disagreement",
    );
  });

  it("does not interrupt when the recommendation preserves the view", () => {
    renderCanvas({
      recommendedScene: withTurn({ ...recommendation, transition: "preserve" }),
    });
    expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
  });

  describe("issue #13: invalidating a stale recommendation", () => {
    it("removes a queued recommendation when its own turn's prop clears", () => {
      const { rerender } = renderCanvas({
        recommendedScene: withTurn(recommendation, "turn-a"),
      });
      expect(
        screen.getByRole("button", { name: "Show it" }),
      ).toBeInTheDocument();

      // The parent only ever nulls `recommendedScene` for the turn that owns
      // it (turnReducer's own turn-id check) — simulating that here is what
      // the client-side invalidation this issue requires must react to.
      rerender(
        <LivingCanvas
          objects={objects}
          relationships={relationships}
          recommendedScene={null}
        />,
      );
      expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
    });

    it("keeps a newer turn's recommendation when a different turn's clears", () => {
      const { rerender } = renderCanvas({
        recommendedScene: withTurn(recommendation, "turn-a"),
      });
      // Turn B's recommendation replaces turn A's — an ordinary update.
      rerender(
        <LivingCanvas
          objects={objects}
          relationships={relationships}
          recommendedScene={withTurn(recommendation, "turn-b")}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Show it" }),
      ).toBeInTheDocument();

      // A stale null for turn A's slot must not appear once turn B owns the
      // queue — nothing forces that ordering here since the reducer already
      // guarantees it, but the client must not misread a prop update as an
      // invalidation of the *newer* recommendation it just adopted.
      expect(
        screen.getByText(/The conversation moved to missing check-in evidence/),
      ).toBeInTheDocument();
    });
  });

  /*
    T10 review round 10, third correction: the issue #13 invalidation above
    only ever retires a queued copy the person has not acted on. Once they
    have selected "Show it", that same scene moves into `sceneState.current`
    — and a later research pass superseding its receipt has nothing left to
    tell the host, because `recommendedScene` was already consumed. Without
    a separate mechanism, the accepted `evidence_research` view is never
    moved off, and `EvidenceResearchRenderer` sits on "Research is
    running…" once the pass that would have resolved it ends without a
    finding.
  */
  describe("a superseded but already-accepted research view (T10 review round 10, third correction)", () => {
    const finding: ResearchFinding = {
      id: "tenancy-deposit-disputes-2024",
      title: "Deposit disputes are common",
      keyFinding: "Roughly 1 in 6.",
      whyItMatters: "It matters.",
      visualisation: { kind: "bar", unit: "%", series: [] },
      sources: [],
      methodology: "Method.",
      limitations: "Limits.",
      retrievedAt: "2026-07-30T00:00:00.000Z",
      isDemo: true,
      conflicting: false,
    };
    const researchRecommendation: CanvasScene = {
      renderer: "evidence_research",
      purpose: "research_evidence",
      focalObjectId: PROBLEM,
      visibleObjectIds: [PROBLEM],
      visibleRelationshipIds: [],
      emphasis: "none",
      reason: "Showing what was found.",
      transition: "replace",
    };

    it("moves off the accepted research view once its receipt is retired, rather than staying on 'Research is running…' indefinitely", async () => {
      const user = userEvent.setup();
      const { rerender } = renderCanvas({
        recommendedScene: withTurn(researchRecommendation),
        activeResearch: finding,
      });

      await user.click(screen.getByRole("button", { name: "Show it" }));
      expect(
        screen.getByText("Deposit disputes are common"),
      ).toBeInTheDocument();

      // A later pass in the same turn supersedes the receipt: turn-events.ts's
      // `research_started` clears both `activeResearch` and the (already
      // consumed) `recommendedScene` prop.
      rerender(
        <LivingCanvas
          objects={objects}
          relationships={relationships}
          recommendedScene={null}
          activeResearch={null}
        />,
      );

      expect(screen.queryByText(/Research is running/)).toBeNull();
      // Falls back to whatever the canvas showed before the research view
      // was accepted — the application's own default, not an empty canvas.
      expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
        "Property-condition disagreement",
      );
    });

    it("leaves an unrelated accepted scene untouched", async () => {
      const user = userEvent.setup();
      const unrelatedRecommendation: CanvasScene = {
        renderer: "problem_exploration",
        purpose: "explore_problem",
        focalObjectId: CAUSE,
        visibleObjectIds: [CAUSE, PROBLEM],
        visibleRelationshipIds: ["bbbbbbbb-0000-4000-8000-000000000001"],
        emphasis: "none",
        reason: "The conversation moved to missing check-in evidence.",
        transition: "replace",
      };
      const { rerender } = renderCanvas({
        recommendedScene: withTurn(unrelatedRecommendation),
      });
      await user.click(screen.getByRole("button", { name: "Show it" }));
      expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
        "Missing check-in evidence",
      );

      // `activeResearch` clearing (e.g. a research pass elsewhere, or simply
      // never having been set) must not move a scene that was never the
      // research view.
      rerender(
        <LivingCanvas
          objects={objects}
          relationships={relationships}
          recommendedScene={null}
          activeResearch={null}
        />,
      );
      expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
        "Missing check-in evidence",
      );
    });
  });
});

describe("impact-review emphasis is driven by the pending proposal, never the scene (T11 review round 1, P1)", () => {
  it("enters impact-review deterministically, with no scene recommended at all", () => {
    renderCanvas({
      pendingProposal: { id: "proposal-1", affectedObjectIds: [CAUSE] },
      onReviewProposal: vi.fn(),
    });
    expect(screen.getByText(/Reviewing a proposed change/)).toBeInTheDocument();
    // CAUSE is affected — full prominence; CONSEQUENCE is not — dimmed.
    const affectedRow = screen
      .getByText("Missing check-in evidence")
      .closest("li");
    const unrelatedRow = screen
      .getByText("Deposit disputes follow")
      .closest("li");
    expect(affectedRow?.firstElementChild?.className).not.toContain(
      "opacity-50",
    );
    expect(unrelatedRow?.firstElementChild?.className).toContain("opacity-50");
  });

  it("ignores the scene's own visibleObjectIds entirely — the proposal names its own affected objects", () => {
    // The scene's own visibility list includes CONSEQUENCE but deliberately
    // omits CAUSE, and is not itself in impact-review — if the renderer ever
    // fell back to `scene.visibleObjectIds` for "affected", CONSEQUENCE
    // would read as affected and CAUSE would not, the opposite of what the
    // proposal actually says. Both relationships stay visible so both
    // branches still lay out — this is about which one gets dimmed, not
    // which one appears at all (a separate, pre-existing scene concern).
    const unrelatedScene: CanvasScene = {
      renderer: "problem_exploration",
      purpose: "explore_problem",
      focalObjectId: PROBLEM,
      visibleObjectIds: [PROBLEM, CONSEQUENCE],
      visibleRelationshipIds: [
        "bbbbbbbb-0000-4000-8000-000000000001",
        "bbbbbbbb-0000-4000-8000-000000000002",
      ],
      emphasis: "none",
      reason: "Showing the problem currently being explored.",
      transition: "preserve",
    };
    renderCanvas({
      initialScene: unrelatedScene,
      pendingProposal: { id: "proposal-1", affectedObjectIds: [CAUSE] },
      onReviewProposal: vi.fn(),
    });
    const affectedRow = screen
      .getByText("Missing check-in evidence")
      .closest("li");
    const unrelatedRow = screen
      .getByText("Deposit disputes follow")
      .closest("li");
    expect(affectedRow?.firstElementChild?.className).not.toContain(
      "opacity-50",
    );
    expect(unrelatedRow?.firstElementChild?.className).toContain("opacity-50");
  });

  it("shows the path to an affected object even when the last scene declared its relationship not visible", () => {
    // docs/ADAPTIVE_CANVAS_MVP.md §4.3: impact review must show the path
    // from the change to affected project areas — deterministically, not
    // only when the model's last recommendation happened to include it.
    // Here the scene explicitly excludes CAUSE's own relationship.
    const narrowScene: CanvasScene = {
      renderer: "problem_exploration",
      purpose: "explore_problem",
      focalObjectId: PROBLEM,
      visibleObjectIds: [PROBLEM, CONSEQUENCE],
      visibleRelationshipIds: ["bbbbbbbb-0000-4000-8000-000000000002"],
      emphasis: "none",
      reason: "Showing the problem currently being explored.",
      transition: "preserve",
    };
    renderCanvas({
      initialScene: narrowScene,
      pendingProposal: { id: "proposal-1", affectedObjectIds: [CAUSE] },
      onReviewProposal: vi.fn(),
    });
    expect(screen.getByText("Missing check-in evidence")).toBeInTheDocument();
  });

  it("marks a real stored relationship between two affected objects as part of the change's own path (T11 review round 2, P1)", () => {
    // PROBLEM is the focal object (always "affected" by construction here)
    // and CAUSE is the proposal's own affected object — the relationship
    // between them is a genuine stored edge, so it should be marked. The
    // CONSEQUENCE branch is not part of the proposal at all and must not be.
    renderCanvas({
      pendingProposal: {
        id: "proposal-1",
        affectedObjectIds: [CAUSE, PROBLEM],
      },
      onReviewProposal: vi.fn(),
    });
    expect(
      screen.getByText("Missing check-in evidence").parentElement,
    ).toHaveTextContent("Part of this change");
    expect(
      screen.getByText("Deposit disputes follow").parentElement,
    ).not.toHaveTextContent("Part of this change");
  });

  it("marks no path when the proposal's affected objects share no stored relationship, rather than inventing one", () => {
    // CAUSE and CONSEQUENCE are both "affected", but nothing connects them
    // to each other directly — only each to PROBLEM, which is not affected
    // here — so there is genuinely no path to show.
    renderCanvas({
      pendingProposal: {
        id: "proposal-1",
        affectedObjectIds: [CAUSE, CONSEQUENCE],
      },
      onReviewProposal: vi.fn(),
    });
    expect(screen.queryByText("Part of this change")).not.toBeInTheDocument();
  });

  it("leaves the canvas out of impact-review once there is nothing pending to review", () => {
    renderCanvas({ pendingProposal: null });
    expect(
      screen.queryByText(/Reviewing a proposed change/),
    ).not.toBeInTheDocument();
  });
});
