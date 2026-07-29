import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  activityLineFor,
  INITIAL_TURN_STATE,
  type TurnState,
} from "@/lib/ai/turn-events";
import { MAX_MESSAGE_LENGTH } from "@/lib/validation/turns";
import { Composer } from "./composer";
import { ConversationStream } from "./conversation-stream";

function stateWith(patch: Partial<TurnState>): TurnState {
  return { ...INITIAL_TURN_STATE, ...patch };
}

const noop = () => {};

describe("ConversationStream", () => {
  it("shows the opening question when there are no messages", () => {
    render(<ConversationStream state={INITIAL_TURN_STATE} />);
    expect(
      screen.getByText("What problem are you trying to solve?"),
    ).toBeInTheDocument();
  });

  it("attributes user turns without bubble styling", () => {
    render(
      <ConversationStream
        state={stateWith({
          messages: [
            {
              id: "m1",
              role: "user",
              content: "Deposit disputes",
              blockKind: "plain",
              createdAt: "2026-07-28T00:00:00.000Z",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Deposit disputes")).toBeInTheDocument();
  });

  it("labels rich blocks in text, not by colour alone", () => {
    render(
      <ConversationStream
        state={stateWith({
          messages: [
            {
              id: "m2",
              role: "assistant",
              content: "That may not hold.",
              blockKind: "challenge",
              heading: "Worth testing",
              createdAt: "2026-07-28T00:00:00.000Z",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Challenge")).toBeInTheDocument();
    expect(screen.getByText("Worth testing")).toBeInTheDocument();
  });

  it("announces activity politely and renders failures as alerts", () => {
    const { rerender } = render(
      <ConversationStream
        state={stateWith({
          messages: [
            {
              id: "m1",
              role: "user",
              content: "x",
              blockKind: "plain",
              createdAt: "2026-07-28T00:00:00.000Z",
            },
          ],
          activity: {
            conversation: activityLineFor(
              "t1",
              "reading_project_model",
              "active",
            ),
            canvas: null,
          },
        })}
      />,
    );
    const live = screen
      .getByText("Reading the current project model…")
      .closest("div");
    expect(live).toHaveAttribute("aria-live", "polite");

    rerender(
      <ConversationStream
        state={stateWith({
          messages: [
            {
              id: "m1",
              role: "user",
              content: "x",
              blockKind: "plain",
              createdAt: "2026-07-28T00:00:00.000Z",
            },
          ],
          error: {
            code: "rate_limited",
            userMessage: "Wait 30 seconds and send again.",
            recoverable: true,
          },
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wait 30 seconds and send again.",
    );
  });
});

describe("Composer", () => {
  it("sends on Enter and inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <Composer
        value="a problem"
        onChange={noop}
        onSend={onSend}
        onStop={noop}
        onAddDirection={noop}
        onAction={noop}
        state={INITIAL_TURN_STATE}
      />,
    );
    const textarea = screen.getByLabelText("Message");
    await user.type(textarea, "{Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);

    await user.type(textarea, "{Shift>}{Enter}{/Shift}");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("cannot send an empty or whitespace-only message", () => {
    render(
      <Composer
        value="   "
        onChange={noop}
        onSend={noop}
        onStop={noop}
        onAddDirection={noop}
        onAction={noop}
        state={INITIAL_TURN_STATE}
      />,
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("swaps Send for Stop while streaming", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        onStop={onStop}
        onAddDirection={noop}
        onAction={noop}
        state={stateWith({ status: "streaming" })}
      />,
    );
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("explains an over-length message instead of failing silently", () => {
    render(
      <Composer
        value={"x".repeat(MAX_MESSAGE_LENGTH + 5)}
        onChange={noop}
        onSend={noop}
        onStop={noop}
        onAddDirection={noop}
        onAction={noop}
        state={INITIAL_TURN_STATE}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "5 characters over the limit",
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("renders contextual actions in a labelled group", () => {
    render(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        onStop={noop}
        onAddDirection={noop}
        onAction={noop}
        state={stateWith({
          actions: [{ id: "a", label: "Research this" }],
        })}
      />,
    );
    expect(
      screen.getByRole("group", { name: "Suggested actions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Research this" }),
    ).toBeInTheDocument();
  });
});
