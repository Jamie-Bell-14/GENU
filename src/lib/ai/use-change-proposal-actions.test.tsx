import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChangeProposalActions } from "./use-change-proposal-actions";

/**
 * The outcome banner's reload hydration (issue #25): `outcome` used to be
 * `useState<ProposalOutcome | null>(null)` unconditionally, so a decided
 * proposal's Review changes/Undo actions only ever existed for the rest of
 * the session that made the decision. `initialOutcome` is what a server
 * loader (`loadLatestDecidedProposal`) seeds this with on a fresh mount.
 */
describe("useChangeProposalActions reload hydration", () => {
  it("starts with the outcome already set when an initial outcome is supplied", () => {
    const { result } = renderHook(() =>
      useChangeProposalActions(
        "project-1",
        () => {},
        () => true,
        {
          proposalId: "proposal-1",
          title: "Narrow the target customer",
          status: "partially_approved",
          areas: ["customer"],
          viewRefreshed: true,
        },
      ),
    );

    expect(result.current.outcome).toEqual({
      proposalId: "proposal-1",
      title: "Narrow the target customer",
      status: "partially_approved",
      areas: ["customer"],
      viewRefreshed: true,
    });
  });

  it("starts with no outcome when nothing was decided as of the last reload", () => {
    const { result } = renderHook(() =>
      useChangeProposalActions(
        "project-1",
        () => {},
        () => true,
      ),
    );

    expect(result.current.outcome).toBeNull();
  });
});
