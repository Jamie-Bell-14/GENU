import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  activityLineFor,
  turnReducer,
  INITIAL_TURN_STATE,
  type Message,
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

/*
  Recovery notices are per-turn, and these tests read the rendered surface
  rather than state: the defect they guard against is one turn's outcome
  appearing to belong to another, which is only visible on screen.
*/
describe("recovery notices belong to their own turn", () => {
  const OLDER = "dddddddd-0000-4000-8000-000000000001";
  const NEWER = "dddddddd-0000-4000-8000-000000000002";

  const question = (id: string, turnId: string, content: string): Message => ({
    id,
    turnId,
    role: "user",
    content,
    blockKind: "plain",
    createdAt: "2026-07-29T00:00:00.000Z",
  });

  const asked = question("m1", OLDER, "A question whose answer was lost");

  it("names the question it concerns, not just 'that turn'", () => {
    render(
      <ConversationStream
        state={stateWith({
          messages: [asked],
          recoveries: [{ turnId: OLDER, state: "unfinished" }],
        })}
        onDismissRecovery={noop}
      />,
    );
    // Two unresolved turns would otherwise produce two identical notices with
    // nothing to say which question each belonged to.
    expect(
      screen.getByText(/“A question whose answer was lost” did not finish/i),
    ).toBeInTheDocument();
    // `role="alert"` is the conversation-level error region. A per-turn
    // outcome must not claim it, or it reads as the active turn failing.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders inside its own turn, not beneath a later streaming turn", () => {
    const { container } = render(
      <ConversationStream
        state={stateWith({
          messages: [asked, question("m2", NEWER, "A later question")],
          streaming: {
            turnId: NEWER,
            text: "Answering the later question",
            blockKind: "plain",
          },
          recoveries: [{ turnId: OLDER, state: "unfinished" }],
        })}
        onDismissRecovery={noop}
      />,
    );

    /*
      Containment is the assertion, not order. The notice living in the older
      turn's group is what stops it reading as a verdict on the turn the user is
      currently watching.
    */
    const groups = Array.from(container.querySelectorAll(":scope > div > div"));
    const olderGroup = groups.find((group) =>
      group.textContent?.includes("A question whose answer was lost"),
    );
    const newerGroup = groups.find((group) =>
      group.textContent?.includes("A later question"),
    );
    expect(olderGroup?.textContent).toContain("did not finish");
    expect(newerGroup?.textContent).not.toContain("did not finish");
    expect(newerGroup?.textContent).toContain("Answering the later question");
  });

  it("shows one notice per unresolved turn, each dismissable on its own", async () => {
    const onDismissRecovery = vi.fn();
    render(
      <ConversationStream
        state={stateWith({
          messages: [asked, question("m2", NEWER, "A later question")],
          recoveries: [
            { turnId: OLDER, state: "unfinished" },
            { turnId: NEWER, state: "still_running" },
          ],
        })}
        onDismissRecovery={onDismissRecovery}
      />,
    );
    expect(screen.getByText(/did not finish/i)).toBeInTheDocument();
    expect(screen.getByText(/still being processed/i)).toBeInTheDocument();

    const dismissals = screen.getAllByRole("button", { name: "Dismiss" });
    expect(dismissals).toHaveLength(2);
    // The first belongs to the first question, because it sits inside it.
    await userEvent.click(dismissals[0]);
    expect(onDismissRecovery).toHaveBeenCalledExactlyOnceWith(OLDER);
  });

  it("leaves the other turn untouched when one is dismissed", () => {
    const state = stateWith({
      messages: [asked, question("m2", NEWER, "A later question")],
      recoveries: [
        { turnId: OLDER, state: "unfinished" },
        { turnId: NEWER, state: "still_running" },
      ],
    });
    const dismissed = turnReducer(state, {
      type: "dismiss_recovery",
      turnId: OLDER,
    });
    render(<ConversationStream state={dismissed} onDismissRecovery={noop} />);

    expect(screen.queryByText(/did not finish/i)).not.toBeInTheDocument();
    expect(screen.getByText(/still being processed/i)).toBeInTheDocument();
  });

  it("offers another look only where the outcome is genuinely unknown", () => {
    render(
      <ConversationStream
        state={stateWith({
          messages: [asked, question("m2", NEWER, "A later question")],
          recoveries: [
            { turnId: OLDER, state: "unfinished" },
            { turnId: NEWER, state: "unavailable" },
          ],
        })}
        onCheckAgain={noop}
      />,
    );
    // A settled "did not finish" has nothing left to check; a lookup that
    // could not be completed does.
    expect(screen.getAllByRole("button", { name: "Check again" })).toHaveLength(
      1,
    );
  });
});
