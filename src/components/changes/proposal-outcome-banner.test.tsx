import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProposalOutcome } from "@/lib/ai/use-change-proposal-actions";
import { ProposalOutcomeBanner } from "./proposal-outcome-banner";

function outcome(overrides: Partial<ProposalOutcome> = {}): ProposalOutcome {
  return {
    proposalId: "proposal-1",
    title: "Narrow the target customer",
    status: "approved",
    areas: ["customer", "value_proposition"],
    ...overrides,
  };
}

describe("ProposalOutcomeBanner (T11, docs/review/06-DESIGN_REVIEW.md §6)", () => {
  it("states what actually happened, in words rather than colour alone", () => {
    render(
      <ProposalOutcomeBanner
        outcome={outcome({ status: "partially_approved" })}
        onDismiss={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    expect(screen.getByText(/Partially approved/)).toBeInTheDocument();
  });

  it("names a rejection honestly rather than implying an approval", () => {
    render(
      <ProposalOutcomeBanner
        outcome={outcome({ status: "rejected" })}
        onDismiss={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    expect(screen.getByText(/kept the current direction/i)).toBeInTheDocument();
  });

  it("only offers the actions it was actually given", () => {
    render(
      <ProposalOutcomeBanner
        outcome={outcome()}
        onDismiss={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Review changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open document" }),
    ).not.toBeInTheDocument();
  });

  it("wires Undo to its own callback when offered", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(
      <ProposalOutcomeBanner
        outcome={outcome()}
        onUndo={onUndo}
        onDismiss={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("wires Dismiss to its own callback", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ProposalOutcomeBanner
        outcome={outcome()}
        onDismiss={onDismiss}
        pending={false}
        error={null}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
