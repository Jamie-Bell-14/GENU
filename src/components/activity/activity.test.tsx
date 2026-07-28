import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activitySurface,
  INITIAL_TURN_STATE,
  NO_ACTIVITY,
  type ActivityLine,
  type TurnState,
} from "@/lib/ai/turn-events";
import { ConversationStream } from "@/components/conversation/conversation-stream";
import { LivingCanvas } from "@/components/canvas/living-canvas";
import type { CanvasObject } from "@/lib/canvas/model";
import { ActivityHistory } from "./activity-history";
import { ActivityIndicator } from "./activity-indicator";

const analysis: ActivityLine = {
  id: "a1",
  kind: "analysis",
  label: "Reading the current project model…",
};

const canvasWork: ActivityLine = {
  id: "a2",
  kind: "model_update",
  label: "Preparing a canvas view of the current problem…",
};

const objects: CanvasObject[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    kind: "concept",
    zone: "subject",
    title: "Property-condition disagreement",
    origin: "user_stated",
    support: "hypothesis",
  },
];

function streamState(activity: ActivityLine | null): TurnState {
  return {
    ...INITIAL_TURN_STATE,
    status: "streaming",
    activity: activity
      ? { ...NO_ACTIVITY, [activitySurface(activity.kind)]: activity }
      : NO_ACTIVITY,
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Tenants and landlords argue about condition.",
        blockKind: "plain",
        createdAt: "2026-07-28T00:00:00.000Z",
      },
    ],
  };
}

describe("activity placement", () => {
  it("announces the current line politely without interrupting", () => {
    render(<ActivityIndicator activity={analysis} />);
    const region = screen.getByText(analysis.label).closest("div");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("keeps the live region present when there is no activity", () => {
    const { container } = render(<ActivityIndicator activity={null} />);
    // The region must exist before it changes, or the change is not announced.
    expect(container.querySelector("[aria-live='polite']")).toBeInTheDocument();
  });

  it("shows ordinary analysis in the conversation", () => {
    render(<ConversationStream state={streamState(analysis)} />);
    expect(screen.getByText(analysis.label)).toBeInTheDocument();
  });

  it("keeps canvas work out of the conversation", () => {
    render(<ConversationStream state={streamState(canvasWork)} />);
    expect(screen.queryByText(canvasWork.label)).not.toBeInTheDocument();
  });

  it("shows canvas work at the canvas", () => {
    render(<LivingCanvas objects={objects} activity={canvasWork} />);
    expect(screen.getByText(canvasWork.label)).toBeInTheDocument();
  });

  it("keeps ordinary analysis off the canvas", () => {
    render(<LivingCanvas objects={objects} activity={analysis} />);
    expect(screen.queryByText(analysis.label)).not.toBeInTheDocument();
  });

  it("states no progress percentage anywhere", () => {
    const { container } = render(<ActivityIndicator activity={analysis} />);
    expect(container.textContent).not.toMatch(/\d+\s?%/);
    expect(container.querySelector("progress")).toBeNull();
  });
});

describe("activity history", () => {
  it("lists what happened, newest first, with the kind of work", async () => {
    const user = userEvent.setup();
    render(
      <ActivityHistory
        lines={[
          { ...analysis, at: "2026-07-28T09:00:00.000Z" },
          { ...canvasWork, at: "2026-07-28T09:01:00.000Z" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Activity history" }));

    const dialog = await screen.findByRole("dialog");
    const entries = within(dialog).getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent(canvasWork.label);
    expect(entries[0]).toHaveTextContent("Project model");
    expect(entries[1]).toHaveTextContent(analysis.label);
  });

  it("says the history is empty rather than showing an empty panel", async () => {
    const user = userEvent.setup();
    render(<ActivityHistory lines={[]} />);
    await user.click(screen.getByRole("button", { name: "Activity history" }));
    expect(
      await screen.findByText(/no activity recorded yet/i),
    ).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<ActivityHistory lines={[analysis]} />);
    await user.click(screen.getByRole("button", { name: "Activity history" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
