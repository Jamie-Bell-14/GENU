import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityLineFor } from "./turn-events";
import { useTurnRuntime } from "./use-turn-runtime";

/**
 * The turn runtime is where a dropped connection and a deliberate Stop are
 * told apart, and where a partial answer either is or is not promoted into the
 * transcript. Both are exercised here against a scripted stream rather than a
 * live server.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TURN = "dddddddd-0000-4000-8000-000000000001";

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** A response whose body yields the given frames, then ends. */
function streamingResponse(frames: string[], options: { end?: boolean } = {}) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= frames.length) {
              if (options.end === false) {
                // Simulates a socket that dies rather than closing cleanly.
                throw new TypeError("network error");
              }
              return { done: true, value: undefined };
            }
            const value = encoder.encode(frames[index]);
            index += 1;
            return { done: false, value };
          },
        };
      },
    },
    json: async () => ({}),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderRuntime() {
  return renderHook(() => useTurnRuntime({ projectId: PROJECT }));
}

describe("losing the stream mid-turn", () => {
  it("catches up from what the server recorded, without duplicating events", async () => {
    const catchUp = {
      activity: [activityLineFor(TURN, "reading_project_model", "succeeded")],
      message: {
        id: "assistant-1",
        role: "assistant",
        content: "The recorded answer.",
        blockKind: "plain",
        createdAt: "2026-07-29T00:00:00.000Z",
      },
    };
    const fetchMock = vi
      .fn()
      // The turn: two frames, then the body simply stops — no `done`.
      .mockResolvedValueOnce(
        streamingResponse([
          sse({ type: "turn_started", turnId: TURN }),
          sse({
            type: "activity",
            activity: activityLineFor(TURN, "reading_project_model", "active"),
          }),
          sse({ type: "assistant_delta", text: "half a sen" }),
        ]),
      )
      // The catch-up request.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "completed", ...catchUp }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => expect(result.current.state.recovery).toBeNull());

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/projects/${PROJECT}/turns/${TURN}`,
      { cache: "no-store" },
    );
    // The recorded answer replaces the partial text rather than joining it.
    const contents = result.current.state.messages.map((m) => m.content);
    expect(contents).toEqual([
      "A problem worth exploring",
      "The recorded answer.",
    ]);
    expect(contents.some((text) => text.includes("half a sen"))).toBe(false);
    // The line arrived live and again on catch-up: it appears once.
    expect(result.current.state.activityLog).toHaveLength(1);
    expect(result.current.state.activityLog[0].state).toBe("succeeded");
    expect(result.current.state.status).toBe("idle");
  });

  it("says the turn did not finish when the server recorded no result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamingResponse([sse({ type: "turn_started", turnId: TURN })], {
          end: false,
        }),
      )
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "failed", activity: [], message: null }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem"));
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() =>
      expect(result.current.state.error?.code).toBe("turn_interrupted"),
    );
    expect(result.current.state.messages).toHaveLength(1);
  });
});

describe("catch-up that races the server", () => {
  it("waits for a turn that is still finishing instead of declaring it empty", async () => {
    const persisted = {
      id: "assistant-1",
      role: "assistant",
      content: "The recorded answer.",
      blockKind: "plain",
      createdAt: "2026-07-29T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamingResponse([sse({ type: "turn_started", turnId: TURN })]),
      )
      // The server has not finished writing the result yet.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "running", activity: [], message: null }),
      } as unknown as Response)
      // A moment later it has.
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "completed",
          activity: [],
          message: persisted,
        }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => expect(result.current.state.recovery).toBeNull(), {
      timeout: 5000,
    });
    expect(result.current.state.messages.map((m) => m.content)).toEqual([
      "A problem worth exploring",
      "The recorded answer.",
    ]);
    // Recovered once, not once per poll.
    expect(
      result.current.state.messages.filter((m) => m.id === "assistant-1"),
    ).toHaveLength(1);
    expect(result.current.state.error).toBeNull();
  });

  it("reports a failed lookup as a failed lookup, not as an unfinished turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamingResponse([sse({ type: "turn_started", turnId: TURN })]),
      )
      .mockResolvedValue({
        ok: false,
        json: async () => ({ status: "lookup_failed" }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    await waitFor(
      () => expect(result.current.state.recovery?.state).toBe("unavailable"),
      { timeout: 5000 },
    );
    // Nothing was established about the turn, so nothing is concluded.
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.recovery?.turnId).toBe(TURN);
  }, 15_000);

  it("never calls a turn the server still reports as running unfinished", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamingResponse([sse({ type: "turn_started", turnId: TURN })]),
      )
      // Every attempt: still running, no result yet.
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "running", activity: [], message: null }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    await waitFor(
      () => expect(result.current.state.recovery?.state).toBe("still_running"),
      { timeout: 5000 },
    );
    // The conclusion the client must never reach from "still running".
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.messages).toHaveLength(1);
    // The bounded polling window is real time, so these two allow for it.
  }, 15_000);

  it("looks again on request, and takes the result once it exists", async () => {
    const persisted = {
      id: TURN,
      role: "assistant",
      content: "The recorded answer.",
      blockKind: "plain",
      createdAt: "2026-07-29T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamingResponse([sse({ type: "turn_started", turnId: TURN })]),
      )
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "running", activity: [], message: null }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });
    await waitFor(
      () => expect(result.current.state.recovery?.state).toBe("still_running"),
      { timeout: 5000 },
    );

    // The turn finishes in the meantime; only another look can find that out.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        activity: [],
        message: persisted,
      }),
    } as unknown as Response);
    await act(async () => {
      await result.current.checkAgain();
    });

    expect(result.current.state.recovery).toBeNull();
    expect(result.current.state.messages.map((m) => m.content)).toEqual([
      "A problem worth exploring",
      "The recorded answer.",
    ]);
  }, 15_000);

  it("recovers the result when the state read lags behind the insert", async () => {
    /*
      The failure this guards: `completed` with the message read taken before
      the insert. That combination never existed, so it must not become a
      verdict — the client looks again and takes the result.
    */
    const persisted = {
      id: TURN,
      role: "assistant",
      content: "The recorded answer.",
      blockKind: "plain",
      createdAt: "2026-07-29T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamingResponse([sse({ type: "turn_started", turnId: TURN })]),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "completed",
          activity: [],
          message: null,
        }),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "completed",
          activity: [],
          message: persisted,
        }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => expect(result.current.state.recovery).toBeNull(), {
      timeout: 10_000,
    });
    expect(result.current.state.messages.map((m) => m.content)).toEqual([
      "A problem worth exploring",
      "The recorded answer.",
    ]);
    // The conclusion that must never be drawn from completed-with-no-message.
    expect(result.current.state.error).toBeNull();
  }, 15_000);

  it("takes a stored result even while the state still says running", async () => {
    // Finalisation has not been recorded yet; the answer exists regardless and
    // must not be discarded for that.
    const persisted = {
      id: TURN,
      role: "assistant",
      content: "The recorded answer.",
      blockKind: "plain",
      createdAt: "2026-07-29T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamingResponse([sse({ type: "turn_started", turnId: TURN })]),
      )
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "running",
          activity: [],
          message: persisted,
        }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    expect(result.current.state.recovery).toBeNull();
    expect(result.current.state.messages).toHaveLength(2);
    expect(result.current.state.error).toBeNull();
  }, 15_000);

  it("reports an expired worker as finished, not as still processing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamingResponse([sse({ type: "turn_started", turnId: TURN })]),
      )
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "expired", activity: [], message: null }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    expect(result.current.state.recovery).toBeNull();
    expect(result.current.state.error?.code).toBe("turn_interrupted");
  }, 15_000);

  it("does not recover a turn whose terminal frame already arrived", async () => {
    /*
      The socket can close badly *after* `done`. The answer is not lost, and
      treating it as lost would duplicate it from catch-up.
    */
    const encoder = new TextEncoder();
    const frames = [
      sse({ type: "turn_started", turnId: TURN }),
      sse({ type: "assistant_delta", text: "The complete answer." }),
      sse({ type: "done" }),
    ];
    let index = 0;
    const response = {
      ok: true,
      body: {
        getReader: () => ({
          async read() {
            if (index < frames.length) {
              const value = encoder.encode(frames[index]);
              index += 1;
              return { done: false, value };
            }
            throw new TypeError("network error");
          },
        }),
      },
      json: async () => ({}),
    } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    // Exactly one assistant response, and no catch-up request was made.
    const responses = result.current.state.messages.filter(
      (message) => message.role === "assistant",
    );
    expect(responses).toHaveLength(1);
    expect(responses[0].content).toBe("The complete answer.");
    expect(result.current.state.recovery).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("stopping a turn", () => {
  it("does not present the partial answer as a finished one", async () => {
    let release: (() => void) | null = null;
    const encoder = new TextEncoder();
    const frames = [
      sse({ type: "turn_started", turnId: TURN }),
      sse({ type: "assistant_delta", text: "a partial thought" }),
    ];
    let index = 0;
    const response = {
      ok: true,
      body: {
        getReader: () => ({
          async read() {
            if (index < frames.length) {
              const value = encoder.encode(frames[index]);
              index += 1;
              return { done: false, value };
            }
            // Hold the stream open until the test stops the turn.
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            const abort = new Error("aborted");
            abort.name = "AbortError";
            throw abort;
          },
        }),
      },
      json: async () => ({}),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    let sent: Promise<void>;
    act(() => {
      sent = result.current.send();
    });

    await waitFor(() => expect(release).not.toBeNull());
    act(() => {
      result.current.stop();
      release!();
    });
    await act(async () => {
      await sent!;
    });

    expect(result.current.state.stopped).toBe(true);
    expect(result.current.state.messages.map((m) => m.content)).toEqual([
      "A problem worth exploring",
    ]);
    expect(result.current.state.streaming).toBeNull();
    expect(result.current.state.status).toBe("idle");
    // A deliberate stop is not an error, and it does not trigger catch-up.
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.recovery).toBeNull();
  });
});

describe("losing the stream before it identifies itself", () => {
  it("recovers by the turn id in the response header", async () => {
    // The first SSE frame carries the turn id, and a connection can die before
    // it arrives. The header is the same fact, outside the fragile body.
    const persisted = {
      id: TURN,
      role: "assistant",
      content: "The recorded answer.",
      blockKind: "plain",
      createdAt: "2026-07-29T00:00:00.000Z",
    };
    const response = {
      ok: true,
      headers: new Headers({ "x-turn-id": TURN }),
      body: {
        getReader: () => ({
          async read(): Promise<never> {
            throw new TypeError("network error");
          },
        }),
      },
      json: async () => ({}),
    } as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "completed",
          activity: [],
          message: persisted,
        }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/projects/${PROJECT}/turns/${TURN}`,
      { cache: "no-store" },
    );
    expect(result.current.state.messages.map((m) => m.content)).toEqual([
      "A problem worth exploring",
      "The recorded answer.",
    ]);
  }, 15_000);

  it("says so plainly when no turn id can be obtained at all", async () => {
    const response = {
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({
          async read(): Promise<never> {
            throw new TypeError("network error");
          },
        }),
      },
      json: async () => ({}),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    await act(async () => {
      await result.current.send();
    });

    // Not silence: the user is told the turn never started.
    expect(result.current.state.error?.userMessage).toMatch(
      /lost before this turn started/i,
    );
    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.status).toBe("idle");
  }, 15_000);
});

describe("adding direction", () => {
  /** A turn that starts and then stays open until the test closes it. */
  function openStream() {
    const encoder = new TextEncoder();
    let sentStart = false;
    let close: (() => void) | null = null;
    const response = {
      ok: true,
      body: {
        getReader: () => ({
          async read() {
            if (!sentStart) {
              sentStart = true;
              return {
                done: false,
                value: encoder.encode(
                  sse({ type: "turn_started", turnId: TURN }),
                ),
              };
            }
            await new Promise<void>((resolve) => {
              close = resolve;
            });
            return { done: true, value: undefined };
          },
        }),
      },
      json: async () => ({}),
    } as unknown as Response;
    return { response, close: () => close?.() };
  }

  /** Starts a turn and leaves it streaming, which is when steering applies. */
  async function streamingTurn() {
    const stream = openStream();
    const fetchMock = vi.fn().mockResolvedValueOnce(stream.response);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderRuntime();
    act(() => result.current.setDraft("A problem worth exploring"));
    let sent: Promise<void>;
    act(() => {
      sent = result.current.send();
    });
    await waitFor(() => expect(result.current.state.status).toBe("streaming"));
    fetchMock.mockClear();
    return {
      result,
      fetchMock,
      finish: async () => {
        stream.close();
        await act(async () => {
          await sent!;
        });
      },
    };
  }

  it("shows the endpoint's refusal instead of silently dropping it", async () => {
    const { result, fetchMock } = await streamingTurn();
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: {
          code: "engine_unavailable",
          userMessage: "That turn is not available.",
          recoverable: false,
        },
      }),
    } as unknown as Response);

    act(() => result.current.setDraft("Focus on smaller agencies"));
    await act(async () => {
      await result.current.addDirection();
    });

    expect(result.current.state.error?.userMessage).toBe(
      "That turn is not available.",
    );
    expect(result.current.state.direction).toBeNull();
    // The draft survives so the direction can be retried.
    expect(result.current.draft).toBe("Focus on smaller agencies");
    // The turn itself is untouched by a refused direction.
    expect(result.current.state.status).toBe("streaming");
  });

  it("reports a network failure rather than claiming the direction landed", async () => {
    const { result, fetchMock } = await streamingTurn();
    fetchMock.mockRejectedValue(new TypeError("network error"));

    act(() => result.current.setDraft("Focus on smaller agencies"));
    await act(async () => {
      await result.current.addDirection();
    });

    expect(result.current.state.error?.userMessage).toMatch(
      /could not be recorded/i,
    );
    expect(result.current.state.direction).toBeNull();
    expect(result.current.draft).toBe("Focus on smaller agencies");
  });

  it("submits once however fast the control is pressed", async () => {
    const { result, fetchMock } = await streamingTurn();
    let resolveDirection: ((value: unknown) => void) | null = null;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDirection = resolve;
      }),
    );

    act(() => result.current.setDraft("Focus on smaller agencies"));
    let first: Promise<void>;
    act(() => {
      first = result.current.addDirection();
    });
    await waitFor(() => expect(result.current.directionPending).toBe(true));

    // A second press while the first is in flight must not send again.
    await act(async () => {
      await result.current.addDirection();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDirection!({
        ok: true,
        json: async () => ({ application: "next_step" }),
      });
      await first!;
    });
    expect(result.current.state.direction).toMatchObject({
      application: "next_step",
      applied: false,
    });
    expect(result.current.draft).toBe("");
  });

  it("clears a previous direction failure once a retry succeeds", async () => {
    const { result, fetchMock } = await streamingTurn();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: {
          code: "engine_unavailable",
          userMessage: "That turn is no longer running.",
          recoverable: false,
        },
      }),
    } as unknown as Response);

    act(() => result.current.setDraft("Focus on smaller agencies"));
    await act(async () => {
      await result.current.addDirection();
    });
    expect(result.current.state.error).not.toBeNull();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ application: "next_step" }),
    } as unknown as Response);
    await act(async () => {
      await result.current.addDirection();
    });

    // The stale failure and the new promise must not be shown together.
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.direction).toMatchObject({
      application: "next_step",
    });
  });

  it("sends the direction against the running turn's id", async () => {
    const { result, fetchMock } = await streamingTurn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ application: "next_step" }),
    } as unknown as Response);

    act(() => result.current.setDraft("Focus on smaller agencies"));
    await act(async () => {
      await result.current.addDirection();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT}/directions`,
      expect.objectContaining({
        body: JSON.stringify({
          turnId: TURN,
          note: "Focus on smaller agencies",
        }),
      }),
    );
  });
});
