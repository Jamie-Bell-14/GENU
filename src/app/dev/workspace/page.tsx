import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { CanvasObject } from "@/lib/canvas/model";

/*
  Dev-only route: the workspace with a sparse model matching the vertical
  slice's Step 2, reviewable without Supabase credentials. The sample is
  labelled demonstration data and never reaches production.
*/
const DEMO_OBJECTS: CanvasObject[] = [
  {
    id: "subject-problem",
    kind: "concept",
    zone: "subject",
    title: "Property-condition disagreement",
    detail:
      "Tenants and landlords disagree about the condition of a property when a tenancy ends.",
    origin: "user_stated",
    support: "hypothesis",
    meta: "Demonstration data",
  },
  {
    id: "related-cause-evidence",
    kind: "concept",
    zone: "related",
    title: "Missing check-in evidence",
    detail: "A possible cause — not yet supported by anything you have said.",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: "related-cause-interpretation",
    kind: "concept",
    zone: "related",
    title: "Conflicting interpretation of wear",
    detail: "A second possible cause, equally unconfirmed.",
    origin: "ai_inferred",
    support: "unexplored",
  },
  {
    id: "assumption-consequence",
    kind: "assumption",
    zone: "assumptions",
    title: "Disagreements usually become deposit disputes",
    detail:
      "Why it matters: it decides whether the product addresses disputes or prevention.",
    origin: "ai_inferred",
    support: "hypothesis",
  },
  {
    id: "outline-problem-doc",
    kind: "document",
    zone: "outline",
    title: "Problem definition",
    detail: "Working draft",
    origin: "user_stated",
    support: "hypothesis",
  },
];

export default function DevWorkspacePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <WorkspaceShell
      projectId="demo"
      projectName="Deposit disputes (demo)"
      canvasObjects={DEMO_OBJECTS}
    />
  );
}
