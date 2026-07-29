// @vitest-environment node
import { describe, expect, it } from "vitest";
import { acceptDirection, takeDirections } from "./trusted-writer";

/**
 * Without the elevated key there is no trusted writer, and these operations
 * must say so rather than returning something that reads as success.
 *
 * `takeDirections` is the sharp case: at a final boundary "no directions" and
 * "the read did not happen" are not the same fact. The first means the window
 * is sealed and nothing was pending; the second means the window may still be
 * open, and a later direction could be accepted into a turn with no boundary
 * left to consume it.
 */
const PROJECT = "11111111-1111-4111-8111-111111111111";
const TURN = "dddddddd-0000-4000-8000-000000000001";

describe("without an elevated key", () => {
  it("reports a failed direction read rather than an empty one", async () => {
    const result = await takeDirections({
      projectId: PROJECT,
      turnId: TURN,
      after: { createdAt: new Date(0).toISOString(), id: TURN },
      seal: true,
    });
    expect(result).toEqual({ ok: false });
    // The shape itself is the point: `{ ok: true, directions: [] }` would be
    // indistinguishable from a confirmed seal.
    expect(result.ok).toBe(false);
  });

  it("refuses to accept a direction rather than pretending it landed", async () => {
    await expect(
      acceptDirection({
        projectId: PROJECT,
        turnId: TURN,
        note: "Focus on smaller agencies.",
        application: "next_step",
      }),
    ).resolves.toBe("unavailable");
  });
});
