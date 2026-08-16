import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProposalCard } from "./proposal-card";

const proposal = {
  id: "proposal-1",
  title: "Narrow the target customer",
  rationale: "The evidence points at smaller agencies.",
  affectedAreas: ["customer", "value_proposition"],
};

describe("ProposalCard (T11, DESIGN.md §13.2)", () => {
  it("shows the database-confirmed title, rationale and human-labelled affected areas", () => {
    render(
      <ProposalCard
        proposal={proposal}
        pending={false}
        error={null}
        onReviewChanges={vi.fn()}
        onApproveDirection={vi.fn()}
        onModifyProposal={vi.fn()}
        onKeepCurrentDirection={vi.fn()}
      />,
    );
    expect(screen.getByText("Narrow the target customer")).toBeInTheDocument();
    expect(
      screen.getByText("The evidence points at smaller agencies."),
    ).toBeInTheDocument();
    expect(screen.getByText("Target customer")).toBeInTheDocument();
    expect(screen.getByText("Value proposition")).toBeInTheDocument();
  });

  it("offers exactly the four actions DESIGN.md §13.2 specifies", () => {
    render(
      <ProposalCard
        proposal={proposal}
        pending={false}
        error={null}
        onReviewChanges={vi.fn()}
        onApproveDirection={vi.fn()}
        onModifyProposal={vi.fn()}
        onKeepCurrentDirection={vi.fn()}
      />,
    );
    for (const label of [
      "Review changes",
      "Approve direction",
      "Modify proposal",
      "Keep current direction",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("wires each action to its own callback", async () => {
    const user = userEvent.setup();
    const onReviewChanges = vi.fn();
    const onApproveDirection = vi.fn();
    const onModifyProposal = vi.fn();
    const onKeepCurrentDirection = vi.fn();
    render(
      <ProposalCard
        proposal={proposal}
        pending={false}
        error={null}
        onReviewChanges={onReviewChanges}
        onApproveDirection={onApproveDirection}
        onModifyProposal={onModifyProposal}
        onKeepCurrentDirection={onKeepCurrentDirection}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve direction" }));
    expect(onApproveDirection).toHaveBeenCalledTimes(1);
    expect(onReviewChanges).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Keep current direction" }),
    );
    expect(onKeepCurrentDirection).toHaveBeenCalledTimes(1);
  });

  it("disables every action while a decision is in flight", () => {
    render(
      <ProposalCard
        proposal={proposal}
        pending
        error={null}
        onReviewChanges={vi.fn()}
        onApproveDirection={vi.fn()}
        onModifyProposal={vi.fn()}
        onKeepCurrentDirection={vi.fn()}
      />,
    );
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("surfaces a decision failure without silently discarding it", () => {
    render(
      <ProposalCard
        proposal={proposal}
        pending={false}
        error="The project has changed since this proposal was made."
        onReviewChanges={vi.fn()}
        onApproveDirection={vi.fn()}
        onModifyProposal={vi.fn()}
        onKeepCurrentDirection={vi.fn()}
      />,
    );
    expect(
      screen.getByText("The project has changed since this proposal was made."),
    ).toBeInTheDocument();
  });
});
