import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ResearchFinding } from "@/lib/research/types";
import { EvidenceResearchRenderer } from "./evidence-research";

function finding(overrides: Partial<ResearchFinding> = {}): ResearchFinding {
  return {
    id: "tenancy-deposit-disputes-2024",
    title: "Deposit disputes are common",
    keyFinding: "Roughly 1 in 6 deposits ends in a dispute.",
    whyItMatters: "It affects which customer segment matters most.",
    visualisation: {
      kind: "bar",
      unit: "% disputed",
      series: [
        { label: "Under 100 properties", value: 12 },
        { label: "Over 500 properties", value: 18 },
      ],
    },
    sources: [
      {
        id: "demo-source-1",
        name: "Demonstration Source One",
        url: null,
        retrievedAt: "2026-07-30T09:00:00.000Z",
      },
    ],
    methodology: "Illustrative annual reporting.",
    limitations: "Demonstration data only.",
    retrievedAt: "2026-07-30T09:00:00.000Z",
    isDemo: true,
    conflicting: false,
    ...overrides,
  };
}

describe("EvidenceResearchRenderer", () => {
  it("shows a waiting state when no finding is available yet", () => {
    render(<EvidenceResearchRenderer finding={null} />);
    expect(screen.getByText(/research is running/i)).toBeInTheDocument();
  });

  it("always shows the demonstration-data label, unconditionally", () => {
    // T10 test requirement: is_demo data can never render without its label —
    // the label here does not branch on `finding.isDemo` at all, because
    // every finding this slice can ever produce is demonstration data.
    render(<EvidenceResearchRenderer finding={finding()} />);
    expect(
      screen.getByText(/demonstration data.*not a live lookup/i),
    ).toBeInTheDocument();
  });

  it("shows the key finding, why it matters and the chart by default", () => {
    render(<EvidenceResearchRenderer finding={finding()} />);
    expect(
      screen.getByText("Roughly 1 in 6 deposits ends in a dispute."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("It affects which customer segment matters most."),
    ).toBeInTheDocument();
    expect(screen.getByText("Under 100 properties")).toBeInTheDocument();
  });

  it("styles conflicting evidence differently from a settled figure", () => {
    const { rerender } = render(
      <EvidenceResearchRenderer finding={finding({ conflicting: false })} />,
    );
    expect(screen.queryByText(/disagree/i)).not.toBeInTheDocument();

    rerender(
      <EvidenceResearchRenderer finding={finding({ conflicting: true })} />,
    );
    expect(screen.getByText(/sources disagree/i)).toBeInTheDocument();
  });

  it("switches between the chart and the data-table alternative", async () => {
    const user = userEvent.setup();
    render(<EvidenceResearchRenderer finding={finding()} />);

    await user.click(screen.getByRole("radio", { name: "Explore data" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Under 100 properties" }),
    ).toBeInTheDocument();
  });

  it("separates inspectable source provenance from the AI's interpretation", async () => {
    const user = userEvent.setup();
    render(<EvidenceResearchRenderer finding={finding()} />);

    await user.click(
      screen.getByRole("button", { name: "Demonstration Source One" }),
    );
    expect(
      screen.getByText("Illustrative annual reporting."),
    ).toBeInTheDocument();
    expect(screen.getByText("Demonstration data only.")).toBeInTheDocument();
    expect(screen.getByText(/AI interpretation/)).toBeInTheDocument();
    expect(
      screen.getByText(/kept separate from this source/i),
    ).toBeInTheDocument();
  });

  it("shows an unavailable source plainly, without hiding it (T10 edge case)", () => {
    render(
      <EvidenceResearchRenderer
        finding={finding()}
        unavailableSources={[
          {
            source: {
              id: "demo-regional-authority-bulletin",
              name: "Demonstration Regional Housing Authority — Illustrative Bulletin",
              url: null,
              retrievedAt: "2026-07-30T09:00:00.000Z",
            },
            reason:
              "This source could not be retrieved in the demonstration run.",
          },
        ]}
      />,
    );
    expect(screen.getByText(/Sources unavailable/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Demonstration Regional Housing Authority/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/could not be retrieved in the demonstration run/i),
    ).toBeInTheDocument();
  });

  it("shows no unavailable-sources section when every source succeeded", () => {
    render(<EvidenceResearchRenderer finding={finding()} />);
    expect(screen.queryByText(/Sources unavailable/i)).not.toBeInTheDocument();
  });
});
