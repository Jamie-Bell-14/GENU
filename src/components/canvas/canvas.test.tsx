import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

describe("editing the user's own meaning", () => {
  const editable: CanvasObject = {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    kind: "concept",
    zone: "subject",
    title: "Property-condition disagreement",
    detail: "Tenants and landlords disagree at tenancy end.",
    origin: "user_stated",
    support: "hypothesis",
    editable: {
      kind: "field",
      text: "Tenants and landlords disagree at tenancy end.",
    },
  };

  it("offers no edit affordance when editing is unavailable", () => {
    render(<StructuredInspector objects={[editable]} />);
    expect(
      screen.queryByLabelText(/^Edit Property-condition/),
    ).not.toBeInTheDocument();
  });

  it("saves edited wording through the supplied handler", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue({ ok: true });
    render(<StructuredInspector objects={[editable]} onEdit={onEdit} />);

    await user.click(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
    const field = screen.getByLabelText("Edit Property-condition disagreement");
    await user.clear(field);
    await user.type(field, "Disagreements about wear and tear at tenancy end.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: editable.id }),
      "Disagreements about wear and tear at tenancy end.",
    );
  });

  it("keeps the user's text and explains the problem when saving fails", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue({
      ok: false,
      error: "That item is no longer available.",
    });
    render(<StructuredInspector objects={[editable]} onEdit={onEdit} />);

    await user.click(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
    const field = screen.getByLabelText("Edit Property-condition disagreement");
    await user.clear(field);
    await user.type(field, "Revised wording");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That item is no longer available.",
    );
    expect(field).toHaveValue("Revised wording");
  });

  it("recovers when the save request is rejected outright", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockRejectedValue(new Error("Network unreachable"));
    render(<StructuredInspector objects={[editable]} onEdit={onEdit} />);

    await user.click(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
    const field = screen.getByLabelText("Edit Property-condition disagreement");
    await user.clear(field);
    await user.type(field, "Revised wording");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be saved/i,
    );
    // The editor leaves the saving state, keeps the text and stays retryable.
    expect(field).toHaveValue("Revised wording");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("cannot save an unchanged or empty value", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<StructuredInspector objects={[editable]} onEdit={onEdit} />);
    await user.click(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("warns before turning inferred text into the user's own wording", async () => {
    const user = userEvent.setup();
    render(
      <StructuredInspector
        objects={[{ ...editable, origin: "ai_inferred" }]}
        onEdit={vi.fn()}
      />,
    );
    await user.click(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
    expect(
      screen.getByText(/marks this as your own wording rather than inferred/i),
    ).toBeInTheDocument();
  });

  it("closes the editor on Escape without saving and restores focus", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<StructuredInspector objects={[editable]} onEdit={onEdit} />);
    await user.click(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
    await user.keyboard("{Escape}");
    const trigger = screen.getByLabelText(
      "Edit Property-condition disagreement",
    );
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    expect(document.activeElement).toBe(trigger);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("restores focus to the edit control after cancelling", async () => {
    const user = userEvent.setup();
    render(<StructuredInspector objects={[editable]} onEdit={vi.fn()} />);
    await user.click(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
  });

  it("restores focus to the edit control after a successful save", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue({ ok: true });
    render(<StructuredInspector objects={[editable]} onEdit={onEdit} />);
    await user.click(
      screen.getByLabelText("Edit Property-condition disagreement"),
    );
    await user.type(
      screen.getByLabelText("Edit Property-condition disagreement"),
      " Revised.",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const trigger = screen.getByLabelText(
        "Edit Property-condition disagreement",
      );
      expect(trigger).toBeInstanceOf(HTMLButtonElement);
      expect(document.activeElement).toBe(trigger);
    });
  });
});

describe("assumption presentation", () => {
  const assumption: CanvasObject = {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    kind: "assumption",
    zone: "assumptions",
    title: "Disagreements usually become deposit disputes",
    origin: "ai_inferred",
    support: "hypothesis",
    alternatives: [
      "Most are settled informally",
      "Only where no record exists",
    ],
    recommendedValidation: "Ask five letting agents about last year.",
  };

  it("shows alternatives and recommended validation when the data exists", () => {
    render(<StructuredInspector objects={[assumption]} />);
    expect(screen.getByText("Possible alternatives")).toBeInTheDocument();
    expect(screen.getByText("Most are settled informally")).toBeInTheDocument();
    expect(screen.getByText("Recommended validation")).toBeInTheDocument();
    expect(
      screen.getByText("Ask five letting agents about last year."),
    ).toBeInTheDocument();
  });

  it("omits both sections when the data is absent", () => {
    render(
      <StructuredInspector
        objects={[
          {
            ...assumption,
            alternatives: undefined,
            recommendedValidation: undefined,
          },
        ]}
      />,
    );
    expect(screen.queryByText("Possible alternatives")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Recommended validation"),
    ).not.toBeInTheDocument();
  });
});
