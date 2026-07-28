import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
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
  const recommendation = {
    renderer: "problem_exploration",
    purpose: "explore_problem",
    focalObjectId: CAUSE,
    visibleObjectIds: [CAUSE, PROBLEM],
    visibleRelationshipIds: ["bbbbbbbb-0000-4000-8000-000000000001"],
    emphasis: "none",
    reason: "The conversation moved to missing check-in evidence.",
    transition: "replace",
  } as const;

  it("queues a recommendation with its reason instead of moving the view", () => {
    renderCanvas({ recommendedScene: recommendation });

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
    renderCanvas({ recommendedScene: recommendation });

    await user.click(screen.getByRole("button", { name: "Show it" }));
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Missing check-in evidence",
    );
  });

  it("lets the user decline and stay where they are", async () => {
    const user = userEvent.setup();
    renderCanvas({ recommendedScene: recommendation });

    await user.click(screen.getByRole("button", { name: "Stay here" }));
    expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
    expect(screen.getByLabelText("Object in focus")).toHaveTextContent(
      "Property-condition disagreement",
    );
  });

  it("returns to the previous scene after accepting one", async () => {
    const user = userEvent.setup();
    renderCanvas({ recommendedScene: recommendation });

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
      recommendedScene: {
        ...recommendation,
        focalObjectId: "eeeeeeee-0000-4000-8000-000000000009",
        visibleObjectIds: ["eeeeeeee-0000-4000-8000-000000000009"],
        visibleRelationshipIds: [],
      },
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
      recommendedScene: { ...recommendation, transition: "preserve" },
    });
    expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
  });
});
