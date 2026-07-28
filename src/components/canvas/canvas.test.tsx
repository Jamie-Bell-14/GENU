import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, type CanvasObject } from "@/lib/canvas/model";
import { StructuredInspector } from "./structured-inspector";

const objects: CanvasObject[] = [
  {
    id: "subject",
    kind: "concept",
    zone: "subject",
    title: "Property-condition disagreement",
    detail: "Tenants and landlords disagree at tenancy end.",
    origin: "user_stated",
    support: "hypothesis",
  },
  {
    id: "related",
    kind: "concept",
    zone: "related",
    title: "Missing check-in evidence",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: "assumption",
    kind: "assumption",
    zone: "assumptions",
    title: "Disputes follow disagreements",
    origin: "ai_inferred",
    support: "hypothesis",
  },
];

describe("StructuredInspector states", () => {
  it("labels each zone as an addressable region", () => {
    render(<StructuredInspector objects={objects} />);
    for (const label of [
      "Current subject",
      "Related concepts",
      "Assumptions",
    ]) {
      expect(screen.getByRole("region", { name: label })).toBeInTheDocument();
    }
  });

  it("states origin and support in text, not colour alone", () => {
    render(<StructuredInspector objects={objects} />);
    expect(screen.getByText("You stated")).toBeInTheDocument();
    expect(screen.getAllByText("Inferred").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hypothesis").length).toBeGreaterThan(0);
    expect(screen.getByText("Unexplored")).toBeInTheDocument();
  });
});

describe("StructuredInspector view operations", () => {
  it("pins an object to the top of its zone", async () => {
    const user = userEvent.setup();
    const many: CanvasObject[] = [
      { ...objects[1], id: "a", title: "First" },
      { ...objects[1], id: "b", title: "Second" },
    ];
    render(<StructuredInspector objects={many} />);
    const related = screen.getByRole("region", { name: "Related concepts" });
    await user.click(within(related).getByLabelText("Pin Second"));

    const titles = within(related)
      .getAllByRole("article")
      .map((el) => within(el).getByRole("heading").textContent);
    expect(titles[0]).toBe("Second");
    expect(within(related).getByText("Pinned")).toBeInTheDocument();
  });

  it("hides an object and reports the count instead of dropping it", async () => {
    const user = userEvent.setup();
    render(<StructuredInspector objects={objects} />);
    const related = screen.getByRole("region", { name: "Related concepts" });
    await user.click(
      within(related).getByLabelText("Hide Missing check-in evidence"),
    );
    expect(
      within(related).queryByText("Missing check-in evidence"),
    ).not.toBeInTheDocument();
    expect(within(related).getByText(/1 hidden/)).toBeInTheDocument();
  });

  it("collapses and expands a zone from the keyboard", async () => {
    const user = userEvent.setup();
    render(<StructuredInspector objects={objects} />);
    const assumptions = screen.getByRole("region", { name: "Assumptions" });
    const toggle = within(assumptions).getByRole("button", {
      name: "Collapse",
    });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(
      within(assumptions).queryByText("Disputes follow disagreements"),
    ).not.toBeInTheDocument();
    await user.click(
      within(assumptions).getByRole("button", { name: "Expand" }),
    );
    expect(
      within(assumptions).getByText("Disputes follow disagreements"),
    ).toBeInTheDocument();
  });

  it("re-centres on an object and restores the view with undo", async () => {
    const user = userEvent.setup();
    render(<StructuredInspector objects={objects} />);
    await user.click(
      screen.getByLabelText("Re-centre on Missing check-in evidence"),
    );
    const subjectZone = screen.getByRole("region", { name: "Current subject" });
    expect(
      within(subjectZone).getByText("Missing check-in evidence"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo view changes" }));
    expect(
      within(screen.getByRole("region", { name: "Current subject" })).getByText(
        "Property-condition disagreement",
      ),
    ).toBeInTheDocument();
  });

  it("offers keyboard-reachable controls for every object type", () => {
    const all: CanvasObject[] = OBJECT_KINDS.map((kind, index) => ({
      id: `k${index}`,
      kind,
      zone: "related",
      title: `A ${kind}`,
      origin: "user_stated",
    }));
    render(<StructuredInspector objects={all} />);
    const related = screen.getByRole("region", { name: "Related concepts" });
    // Zone limit applies, so check the rendered subset carries all controls.
    for (const article of within(related).getAllByRole("article")) {
      expect(within(article).getByLabelText(/^Pin /)).toBeInTheDocument();
      expect(within(article).getByLabelText(/^Hide /)).toBeInTheDocument();
      expect(
        within(article).getByLabelText(/^Re-centre on /),
      ).toBeInTheDocument();
    }
  });

  it("keeps long titles inside the object frame", () => {
    render(
      <StructuredInspector
        objects={[
          {
            ...objects[0],
            title: "A".repeat(300),
          },
        ]}
      />,
    );
    const heading = screen.getByRole("heading", { name: "A".repeat(300) });
    expect(heading.className).toContain("break-words");
  });
});
