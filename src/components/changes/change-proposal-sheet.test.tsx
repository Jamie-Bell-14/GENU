import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChangeProposalDetail } from "@/lib/services/change-proposals";
import { ChangeProposalSheet } from "./change-proposal-sheet";

function detail(
  overrides: Partial<ChangeProposalDetail> = {},
): ChangeProposalDetail {
  return {
    id: "proposal-1",
    title: "Narrow the target customer",
    rationale: "The evidence points at smaller agencies.",
    remainingUncertainty: "No pricing evidence yet.",
    status: "proposed",
    items: [
      {
        id: "item-customer",
        area: "customer",
        key: "primary_customer",
        before: "Letting agencies",
        after: "Letting agencies under 20 staff",
        included: true,
      },
      {
        id: "item-value",
        area: "value_proposition",
        key: "core_value",
        before: null,
        after: "Faster deposit disputes",
        included: true,
      },
    ],
    ...overrides,
  };
}

describe("ChangeProposalSheet (T11, docs/review/06-DESIGN_REVIEW.md §6)", () => {
  it("shows a loading state before the detail resolves", () => {
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={() => new Promise(() => {})}
        onApprove={vi.fn()}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders one row per item, before stacked above the proposed value", async () => {
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () => detail()}
        onApprove={vi.fn()}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    expect(await screen.findByText("Letting agencies")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Letting agencies under 20 staff"),
    ).toBeInTheDocument();
    expect(screen.getByText("Not yet set")).toBeInTheDocument();
  });

  it("reports a proposal RLS could not find as unavailable, not as an empty list", async () => {
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () => null}
        onApprove={vi.fn()}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it("warns on partial approval, specific that excluded items keep their current values", async () => {
    const user = userEvent.setup();
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () => detail()}
        onApprove={vi.fn()}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    await screen.findByText("Letting agencies");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Included" })[0]);
    expect(
      screen.getByText(/approving only part of this proposal/i),
    ).toBeInTheDocument();
  });

  it("relabels Approve as Reject proposal once every item is excluded", async () => {
    const user = userEvent.setup();
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () => detail()}
        onApprove={vi.fn()}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    await screen.findByText("Letting agencies");
    for (const button of screen.getAllByRole("button", { name: "Included" })) {
      await user.click(button);
    }
    expect(
      screen.getByRole("button", { name: "Reject proposal" }),
    ).toBeInTheDocument();
  });

  it("submits included:false for an excluded item and no after override for an unedited one", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn().mockResolvedValue(true);
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () => detail()}
        onApprove={onApprove}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    await screen.findByText("Letting agencies");
    // Exclude the second item; leave the first exactly as proposed.
    await user.click(screen.getAllByRole("button", { name: "Included" })[1]);
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(onApprove).toHaveBeenCalledWith([
      { itemId: "item-customer", included: true, after: undefined },
      { itemId: "item-value", included: false, after: undefined },
    ]);
  });

  it("closes the sheet once an approval genuinely succeeds", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () => detail()}
        onApprove={async () => true}
        onOpenChange={onOpenChange}
        pending={false}
        error={null}
      />,
    );
    await screen.findByText("Letting agencies");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("stays open when the decision is refused, surfacing the caller's error instead", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () => detail()}
        onApprove={async () => false}
        onOpenChange={onOpenChange}
        pending={false}
        error="The project has changed since this proposal was made."
      />,
    );
    await screen.findByText("Letting agencies");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByText("The project has changed since this proposal was made."),
    ).toBeInTheDocument();
  });
});
