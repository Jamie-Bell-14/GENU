import { NextResponse } from "next/server";
import { DEMO_OBJECTS, DEMO_RELATIONSHIPS } from "@/lib/dev/demo-project";
import { listDevFields } from "@/lib/dev/dev-project-fields";

export const runtime = "nodejs";

/**
 * Development-only mirror of `/api/projects/[projectId]/model`: the demo
 * canvas's fixed objects, plus any field a dev-mode connected-change
 * proposal has actually approved or undone (`dev-project-fields.ts`).
 *
 * Without this, an approval in the demo workspace could say "Approved" while
 * the canvas kept showing its original state forever — the same gap T11
 * review round 2 flagged for the real route ("assert the visible
 * canvas/structured project state updates and restores"). Unavailable in
 * production; see `dev-project-fields.ts`'s doc for why an in-memory store
 * is acceptable only here.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const fieldObjects = listDevFields().map((field) => ({
    id: field.id,
    kind: field.area === "problem" ? "concept" : "document",
    zone: field.area === "problem" ? "subject" : "outline",
    title: field.label,
    detail: field.value,
    origin: field.origin,
    support: field.support,
    meta: new Date(field.updatedAt).toLocaleDateString("en-GB"),
    editable: { kind: "field", text: field.value },
  }));

  return NextResponse.json({
    objects: [...DEMO_OBJECTS, ...fieldObjects],
    // No dev field ever has a stored relationship to another object — the
    // demo model's own relationships are unaffected by field decisions.
    relationships: DEMO_RELATIONSHIPS,
  });
}
