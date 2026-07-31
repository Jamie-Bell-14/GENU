import { z } from "zod";

/** Matches the messages.content database constraint. */
export const MAX_MESSAGE_LENGTH = 8000;

export const TurnRequestSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, "Write a message before sending.")
      .max(
        MAX_MESSAGE_LENGTH,
        `Messages are limited to ${MAX_MESSAGE_LENGTH.toLocaleString("en-GB")} characters. Shorten it and send again.`,
      ),
    /**
     * The research receipt the client is currently looking at, if any (T10).
     * An opaque id into `research_findings` — never content itself, and
     * never trusted as such: "Add as evidence" resolves the receipt and its
     * recorded target from that table, never from anything else the client
     * sends about the finding.
     */
    activeFindingId: z.string().trim().min(1).max(100).nullish(),
  })
  .strict();

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

/** Turn rate limit (SECURITY_STANDARDS §17). */
export const TURN_RATE_LIMIT = { action: "turn", limit: 20, windowSeconds: 60 };

/**
 * Steering is a separate write path and gets its own budget: it is cheap and
 * legitimately repeated within one turn, but it still inserts rows, so it is
 * bounded rather than trusted.
 */
export const DIRECTION_RATE_LIMIT = {
  action: "direction",
  limit: 30,
  windowSeconds: 60,
};
