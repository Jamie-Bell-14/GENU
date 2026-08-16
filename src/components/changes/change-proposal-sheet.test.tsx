import { render, screen, waitFor, within } from "@testing-library/react";
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
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("Value proposition");
    expect(warning).toHaveTextContent("Target customer");
    expect(warning).toHaveTextContent("stays as it is");
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

describe("ChangeProposalSheet read-only mode for a decided proposal (T11 review round 1, P1)", () => {
  it("shows the recorded status and no Approve action for an approved proposal", async () => {
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () => detail({ status: "approved" })}
        onApprove={vi.fn()}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    await screen.findByText("Letting agencies");

    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject proposal" }),
    ).not.toBeInTheDocument();
    // Two "Close" buttons exist (the sheet's own dismiss icon plus the
    // footer's), so scope to the footer to confirm it reads "Close" rather
    // than "Cancel" once the proposal is decided.
    const footer = document.querySelector('[data-slot="sheet-footer"]');
    expect(footer).not.toBeNull();
    expect(
      within(footer as HTMLElement).getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();
  });

  it("renders the recorded include/exclude state as static text, not toggleable controls", async () => {
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () =>
          detail({
            status: "partially_approved",
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
                included: false,
              },
            ],
          })
        }
        onApprove={vi.fn()}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    await screen.findByText("Letting agencies");

    expect(screen.getByText("Partially approved")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Included" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Excluded" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Letting agencies under 20 staff"),
    ).toBeInTheDocument();
    expect(screen.getByText("Faster deposit disputes")).toBeInTheDocument();
    // No partial-approval warning — this is a settled record, not a live
    // decision the user could still change their mind about.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a rejected proposal read-only with no editable controls", async () => {
    render(
      <ChangeProposalSheet
        proposalId="proposal-1"
        title="Narrow the target customer"
        loadDetail={async () =>
          detail({
            status: "rejected",
            items: [
              {
                id: "item-customer",
                area: "customer",
                key: "primary_customer",
                before: "Letting agencies",
                after: "Letting agencies under 20 staff",
                included: false,
              },
            ],
          })
        }
        onApprove={vi.fn()}
        onOpenChange={vi.fn()}
        pending={false}
        error={null}
      />,
    );
    await screen.findByText("Letting agencies");

    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });
});
