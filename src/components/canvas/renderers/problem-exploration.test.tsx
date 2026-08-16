import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CanvasObject } from "@/lib/canvas/model";
import { buildProblemMap, EMPTY_MAP_VIEW } from "@/lib/canvas/problem-map";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import { ProblemExplorationRenderer } from "./problem-exploration";

/**
 * The impact-review emphasis state (T11, docs/ADAPTIVE_CANVAS_MVP.md §4.3):
 * highlights the objects a pending proposal actually touches and reduces
 * the prominence of everything else, without hiding it or implying the
 * change has already applied.
 */

const FOCAL = "aaaaaaaa-0000-4000-8000-000000000001";
const AFFECTED = "aaaaaaaa-0000-4000-8000-000000000002";
const UNRELATED = "aaaaaaaa-0000-4000-8000-000000000003";

function object(
  id: string,
  overrides: Partial<CanvasObject> = {},
): CanvasObject {
  return {
    id,
    kind: "concept",
    zone: "related",
    title: `Object ${id.slice(-1)}`,
    origin: "ai_inferred",
    ...overrides,
  };
}

const objects = [
  object(FOCAL, {
    zone: "subject",
    title: "Target customer",
    origin: "user_stated",
  }),
  object(AFFECTED, { title: "Affected concept" }),
  object(UNRELATED, { title: "Unrelated concept" }),
];

const relationships: ProjectRelationship[] = [
  {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    fromObjectId: AFFECTED,
    toObjectId: FOCAL,
    relation: "affects",
    origin: "ai_inferred",
    support: "hypothesis",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    fromObjectId: UNRELATED,
    toObjectId: FOCAL,
    relation: "affects",
    origin: "ai_inferred",
    support: "hypothesis",
  },
];

const map = buildProblemMap(objects, relationships, FOCAL, EMPTY_MAP_VIEW);

const operations = {
  onFocus: vi.fn(),
  onToggleBranch: vi.fn(),
  onPin: vi.fn(),
  onHide: vi.fn(),
  onRecentre: vi.fn(),
  onInspect: vi.fn(),
};

describe("ProblemExplorationRenderer impact-review emphasis (T11)", () => {
  it("shows no banner and no ring when emphasis is none", () => {
    render(
      <ProblemExplorationRenderer
        map={map}
        pinned={[]}
        emphasis="none"
        affectedObjectIds={[FOCAL]}
        operations={operations}
      />,
    );
    expect(
      screen.queryByText(/Reviewing a proposed change/),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Object in focus").className).not.toContain(
      "ring-edge-focus",
    );
  });

  it("rings the focal object only when it is itself among the affected objects", () => {
    const { rerender } = render(
      <ProblemExplorationRenderer
        map={map}
        pinned={[]}
        emphasis="impact_review"
        affectedObjectIds={[AFFECTED]}
        operations={operations}
      />,
    );
    expect(screen.getByLabelText("Object in focus").className).not.toContain(
      "ring-edge-focus",
    );

    rerender(
      <ProblemExplorationRenderer
        map={map}
        pinned={[]}
        emphasis="impact_review"
        affectedObjectIds={[FOCAL]}
        operations={operations}
      />,
    );
    expect(screen.getByLabelText("Object in focus").className).toContain(
      "ring-edge-focus",
    );
  });

  it("dims a branch member the proposal does not touch, and leaves the affected one at full prominence", () => {
    render(
      <ProblemExplorationRenderer
        map={map}
        pinned={[]}
        emphasis="impact_review"
        affectedObjectIds={[FOCAL, AFFECTED]}
        operations={operations}
      />,
    );
    const affectedRow = screen.getByText("Affected concept").closest("li");
    const unrelatedRow = screen.getByText("Unrelated concept").closest("li");
    expect(affectedRow?.firstElementChild?.className).not.toContain(
      "opacity-50",
    );
    expect(unrelatedRow?.firstElementChild?.className).toContain("opacity-50");
  });

  it("never dims anything outside impact-review, whatever affectedObjectIds says", () => {
    render(
      <ProblemExplorationRenderer
        map={map}
        pinned={[]}
        emphasis="none"
        affectedObjectIds={[AFFECTED]}
        operations={operations}
      />,
    );
    const unrelatedRow = screen.getByText("Unrelated concept").closest("li");
    expect(unrelatedRow?.firstElementChild?.className).not.toContain(
      "opacity-50",
    );
  });

  it("offers Review changes only while impact-review is active and a handler is supplied", () => {
    const { rerender } = render(
      <ProblemExplorationRenderer
        map={map}
        pinned={[]}
        emphasis="none"
        operations={operations}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Review changes" }),
    ).not.toBeInTheDocument();

    rerender(
      <ProblemExplorationRenderer
        map={map}
        pinned={[]}
        emphasis="impact_review"
        operations={operations}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Review changes" }),
    ).not.toBeInTheDocument();
  });

  it("wires Review changes to its own callback", async () => {
    const user = userEvent.setup();
    const onReviewProposal = vi.fn();
    render(
      <ProblemExplorationRenderer
        map={map}
        pinned={[]}
        emphasis="impact_review"
        onReviewProposal={onReviewProposal}
        operations={operations}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    expect(onReviewProposal).toHaveBeenCalledTimes(1);
  });
});
