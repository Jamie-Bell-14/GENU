import { notFound } from "next/navigation";
import { DevWorkspace } from "./dev-workspace";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";

/*
  Dev-only route: the workspace with a sparse model matching the vertical
  slice's Step 2, reviewable without Supabase credentials. The sample is
  labelled demonstration data and never reaches production.
*/
const DEMO_OBJECTS: CanvasObject[] = [
  {
    id: "22222222-2222-4222-8222-000000000001",
    kind: "concept",
    zone: "subject",
    title: "Property-condition disagreement",
    detail:
      "Tenants and landlords disagree about the condition of a property when a tenancy ends.",
    origin: "user_stated",
    support: "hypothesis",
    meta: "Demonstration data",
    editable: {
      kind: "field",
      text: "Tenants and landlords disagree about the condition of a property when a tenancy ends.",
    },
  },
  {
    id: "22222222-2222-4222-8222-000000000002",
    kind: "concept",
    zone: "related",
    title: "Missing check-in evidence",
    detail: "A possible cause — not yet supported by anything you have said.",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: "22222222-2222-4222-8222-000000000003",
    kind: "concept",
    zone: "related",
    title: "Conflicting interpretation of wear",
    detail: "A second possible cause, equally unconfirmed.",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: "22222222-2222-4222-8222-000000000004",
    kind: "assumption",
    zone: "assumptions",
    title: "Disagreements usually become deposit disputes",
    detail:
      "Why it matters: it decides whether the product addresses disputes or prevention.",
    origin: "ai_inferred",
    support: "hypothesis",
    editable: {
      kind: "assumption",
      text: "Disagreements usually become deposit disputes",
    },
    alternatives: [
      "Most disagreements are settled informally without a dispute",
      "Disputes arise mainly where no check-in record exists",
    ],
    recommendedValidation:
      "Ask five letting agents how many condition disagreements reached a scheme last year.",
  },
  {
    id: "22222222-2222-4222-8222-000000000005",
    kind: "document",
    zone: "outline",
    title: "Problem definition",
    detail: "Working draft",
    origin: "user_stated",
    support: "hypothesis",
  },
];

/* Stored relationships for the demo model. The map renders only these — it
   never derives a connection from layout. */
const DEMO_RELATIONSHIPS: ProjectRelationship[] = [
  {
    id: "11111111-1111-4111-8111-000000000001",
    fromObjectId: "22222222-2222-4222-8222-000000000002",
    toObjectId: "22222222-2222-4222-8222-000000000001",
    relation: "possible_cause_of",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: "11111111-1111-4111-8111-000000000002",
    fromObjectId: "22222222-2222-4222-8222-000000000003",
    toObjectId: "22222222-2222-4222-8222-000000000001",
    relation: "possible_cause_of",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: "11111111-1111-4111-8111-000000000003",
    fromObjectId: "22222222-2222-4222-8222-000000000004",
    toObjectId: "22222222-2222-4222-8222-000000000001",
    relation: "consequence_of",
    origin: "ai_inferred",
    support: "hypothesis",
  },
  {
    id: "11111111-1111-4111-8111-000000000004",
    fromObjectId: "22222222-2222-4222-8222-000000000005",
    toObjectId: "22222222-2222-4222-8222-000000000001",
    relation: "derived_from",
    origin: "user_stated",
    support: "hypothesis",
  },
];

export default function DevWorkspacePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <DevWorkspace objects={DEMO_OBJECTS} relationships={DEMO_RELATIONSHIPS} />
  );
}
