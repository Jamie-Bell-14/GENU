import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  INITIAL_TURN_STATE,
  type Message,
  type TurnState,
} from "@/lib/ai/turn-events";
import { ConversationStream } from "./conversation-stream";

/**
 * Attribution in the rendered transcript.
 *
 * A recovered answer arrives after later questions have been sent, so a flat
 * arrival-order list would show it as the response to the wrong question. These
 * assertions are against what is on screen, not against the message array.
 */
const TURN_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TURN_B = "bbbbbbbb-0000-4000-8000-00000000000b";

function message(patch: Partial<Message> & Pick<Message, "id" | "content">) {
  return {
    role: "user" as const,
    blockKind: "plain" as const,
    createdAt: "2026-07-29T00:00:00.000Z",
    ...patch,
  };
}

/** The rendered conversation, in order, as a reader sees it. */
function transcript(): string[] {
  return screen
    .getAllByRole("article")
    .map(
      (article) =>
        `${article.getAttribute("aria-label")}: ${article.textContent
          ?.replace(/^You/, "")
          .trim()}`,
    );
}

function stateWith(patch: Partial<TurnState>): TurnState {
  return { ...INITIAL_TURN_STATE, ...patch };
}

describe("transcript attribution", () => {
  it("renders a recovered answer under its own question, not the latest one", () => {
    render(
      <ConversationStream
        state={stateWith({
          messages: [
            message({ id: "u1", turnId: TURN_A, content: "The first problem" }),
            message({
              id: "u2",
              turnId: TURN_B,
              content: "The second problem",
            }),
            // Arrived last, belongs to the first turn.
            message({
              id: TURN_A,
              turnId: TURN_A,
              role: "assistant",
              content: "The first answer",
            }),
          ],
          streaming: {
            turnId: TURN_B,
            text: "The second answer, still arriving",
            blockKind: "plain",
          },
          status: "streaming",
        })}
      />,
    );

    expect(transcript()).toEqual([
      "Your turn: The first problem",
      "Response: The first answer",
      "Your turn: The second problem",
      "Response: The second answer, still arriving",
    ]);
  });

  it("does not duplicate or move an answer when catch-up replays it", () => {
    const messages: Message[] = [
      message({ id: "u1", turnId: TURN_A, content: "The first problem" }),
      message({
        id: TURN_A,
        turnId: TURN_A,
        role: "assistant",
        content: "The first answer",
      }),
      message({ id: "u2", turnId: TURN_B, content: "The second problem" }),
    ];
    const { rerender } = render(
      <ConversationStream state={stateWith({ messages })} />,
    );
    const before = transcript();

    // The reducer de-duplicates by id, so a replay renders the same thing.
    rerender(
      <ConversationStream state={stateWith({ messages: [...messages] })} />,
    );
    expect(transcript()).toEqual(before);
    expect(transcript()).toEqual([
      "Your turn: The first problem",
      "Response: The first answer",
      "Your turn: The second problem",
    ]);
  });

  it("renders server-hydrated history in turn order", () => {
    render(
      <ConversationStream
        state={stateWith({
          messages: [
            message({ id: "u1", turnId: TURN_A, content: "The first problem" }),
            message({
              id: TURN_A,
              turnId: TURN_A,
              role: "assistant",
              content: "The first answer",
            }),
            message({
              id: "u2",
              turnId: TURN_B,
              content: "The second problem",
            }),
            message({
              id: TURN_B,
              turnId: TURN_B,
              role: "assistant",
              content: "The second answer",
            }),
          ],
        })}
      />,
    );

    expect(transcript()).toEqual([
      "Your turn: The first problem",
      "Response: The first answer",
      "Your turn: The second problem",
      "Response: The second answer",
    ]);
  });

  it("keeps a question in place before the server has named its turn", () => {
    // Between sending and `turn_started`, a message has no turn id yet.
    render(
      <ConversationStream
        state={stateWith({
          messages: [message({ id: "u1", content: "A problem just sent" })],
          status: "sending",
        })}
      />,
    );
    expect(transcript()).toEqual(["Your turn: A problem just sent"]);
  });

  it("shows an unattributed response rather than attaching it to a question", () => {
    render(
      <ConversationStream
        state={stateWith({
          messages: [
            message({ id: "u1", turnId: TURN_A, content: "The first problem" }),
            message({
              id: "orphan",
              role: "assistant",
              content: "An answer with no turn",
            }),
          ],
        })}
      />,
    );
    // Present, but not rendered as the answer to the first problem: it forms
    // its own group after it rather than joining that one.
    expect(transcript()).toEqual([
      "Your turn: The first problem",
      "Response: An answer with no turn",
    ]);
    expect(screen.getAllByRole("article")[0].textContent).not.toContain(
      "An answer with no turn",
    );
  });
});
