import { describe, expect, it } from "vitest";
import {
  EditObjectSchema,
  MAX_ASSUMPTION_STATEMENT,
  MAX_FIELD_VALUE,
} from "./edit";

const OBJECT_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function input(overrides: Record<string, unknown> = {}) {
  return {
    objectId: OBJECT_ID,
    kind: "field",
    text: "Tenants and landlords disagree at tenancy end.",
    ...overrides,
  };
}

describe("EditObjectSchema", () => {
  it("accepts a valid field edit and trims surrounding whitespace", () => {
    const result = EditObjectSchema.safeParse(input({ text: "  spaced  " }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.text).toBe("spaced");
  });

  it("rejects empty or whitespace-only text rather than blanking an object", () => {
    expect(EditObjectSchema.safeParse(input({ text: "" })).success).toBe(false);
    expect(EditObjectSchema.safeParse(input({ text: "   " })).success).toBe(
      false,
    );
  });

  it("enforces the per-kind length limits from the database", () => {
    expect(
      EditObjectSchema.safeParse(input({ text: "x".repeat(MAX_FIELD_VALUE) }))
        .success,
    ).toBe(true);
    expect(
      EditObjectSchema.safeParse(
        input({ text: "x".repeat(MAX_FIELD_VALUE + 1) }),
      ).success,
    ).toBe(false);

    // Assumptions are constrained more tightly than fields.
    expect(
      EditObjectSchema.safeParse(
        input({
          kind: "assumption",
          text: "x".repeat(MAX_ASSUMPTION_STATEMENT + 1),
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown kinds, malformed ids and unknown fields", () => {
    expect(
      EditObjectSchema.safeParse(input({ kind: "evidence" })).success,
    ).toBe(false);
    expect(
      EditObjectSchema.safeParse(input({ objectId: "not-a-uuid" })).success,
    ).toBe(false);
    // Strict schema: a smuggled origin or support cannot ride along with text.
    expect(
      EditObjectSchema.safeParse({ ...input(), origin: "researched" }).success,
    ).toBe(false);
    expect(
      EditObjectSchema.safeParse({ ...input(), support: "credible" }).success,
    ).toBe(false);
  });
});
