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
  })
  .strict();

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

/** Turn rate limit (SECURITY_STANDARDS §17). */
export const TURN_RATE_LIMIT = { action: "turn", limit: 20, windowSeconds: 60 };
