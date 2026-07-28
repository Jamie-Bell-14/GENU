import { z } from "zod";
import { ORIGINS, SUPPORT_STATES } from "./model";

/**
 * Closed relationship vocabulary (docs/ADAPTIVE_CANVAS_MVP.md §5), mirroring
 * the `relationship_type` enum. Renderers display only stored relationships;
 * nothing here may be inferred from layout (docs/AI_SYSTEM.md §9.2).
 */
export const RELATIONSHIP_TYPES = [
  "possible_cause_of",
  "consequence_of",
  "affects",
  "supports",
  "contradicts",
  "derived_from",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface ProjectRelationship {
  id: string;
  fromObjectId: string;
  toObjectId: string;
  relation: RelationshipType;
  origin: (typeof ORIGINS)[number];
  support: (typeof SUPPORT_STATES)[number];
  note?: string;
}

/**
 * Branch headings, phrased from the focal object outward so a reader can
 * follow the direction of the relationship without inspecting the data.
 */
export const RELATIONSHIP_BRANCH_LABELS: Record<
  RelationshipType,
  { outgoing: string; incoming: string }
> = {
  possible_cause_of: {
    outgoing: "Possible cause of",
    incoming: "Possible causes",
  },
  consequence_of: { outgoing: "Consequence of", incoming: "Consequences" },
  affects: { outgoing: "Affects", incoming: "Affected by" },
  supports: { outgoing: "Supports", incoming: "Supported by" },
  contradicts: { outgoing: "Contradicts", incoming: "Contradicted by" },
  derived_from: { outgoing: "Derived from", incoming: "Basis for" },
};

/** Order branches by reasoning purpose, not alphabetically. */
export const BRANCH_ORDER: RelationshipType[] = [
  "possible_cause_of",
  "consequence_of",
  "affects",
  "supports",
  "contradicts",
  "derived_from",
];

/**
 * Validation for relationship creation. Endpoints are checked against the
 * caller's project by the service layer; the database enforces the same
 * constraint through composite foreign keys.
 */
export const CreateRelationshipSchema = z
  .object({
    fromObjectId: z.string().uuid(),
    toObjectId: z.string().uuid(),
    relation: z.enum(RELATIONSHIP_TYPES),
    origin: z.enum(ORIGINS),
    support: z.enum(SUPPORT_STATES).default("hypothesis"),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((value) => value.fromObjectId !== value.toObjectId, {
    message: "A relationship cannot connect an object to itself.",
    path: ["toObjectId"],
  });

export type CreateRelationshipInput = z.infer<typeof CreateRelationshipSchema>;
