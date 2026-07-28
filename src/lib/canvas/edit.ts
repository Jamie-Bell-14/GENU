import { z } from "zod";

/**
 * Editing the user's own meaning (docs/VERTICAL_SLICE_SPEC.md Step 2
 * acceptance: "the user's original meaning remains editable";
 * docs/ADAPTIVE_CANVAS_MVP.md §4.4).
 *
 * Provenance rule: text a user writes is user-stated, always. Editing an
 * AI-inferred object therefore promotes its origin to `user_stated` — the
 * words are now the user's, and continuing to label them "Inferred" would
 * misattribute authorship. Support state is left untouched: rewording a claim
 * does not create evidence for it.
 */
export const MAX_FIELD_VALUE = 2000;
export const MAX_ASSUMPTION_STATEMENT = 1000;

export const EditObjectSchema = z
  .object({
    objectId: z.string().uuid(),
    kind: z.enum(["field", "assumption"]),
    text: z
      .string()
      .trim()
      .min(1, "Text cannot be empty. Delete the object instead.")
      .max(MAX_FIELD_VALUE),
  })
  .strict()
  .refine(
    (value) =>
      value.kind !== "assumption" ||
      value.text.length <= MAX_ASSUMPTION_STATEMENT,
    {
      message: `Assumptions are limited to ${MAX_ASSUMPTION_STATEMENT} characters.`,
      path: ["text"],
    },
  );

export type EditObjectInput = z.infer<typeof EditObjectSchema>;

export interface EditResult {
  ok: boolean;
  /** Present on failure; explains what the user can correct. */
  error?: string;
}
