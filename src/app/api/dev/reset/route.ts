import { NextResponse } from "next/server";
import { resetDevFields } from "@/lib/dev/dev-project-fields";
import { resetDevProposals } from "@/lib/dev/pending-proposals";

export const runtime = "nodejs";

/**
 * Clears the dev-only connected-change proposal stores back to empty.
 *
 * `pending-proposals.ts` and `dev-project-fields.ts` are process-wide,
 * module-level state, because the dev workspace has no database at all. That
 * is fine for a single interactive session, but a Playwright run shares one
 * `next dev` server across every test file and worker — without an explicit
 * reset, an earlier test's approved field is still there (T11 review round
 * 2) when a later, unrelated test creates its own proposal and reads
 * "before" from the same key. Called from each change-proposals e2e test's
 * own `beforeEach`, with that spec file running serially so a reset can
 * never land mid-test for a test running concurrently in another worker.
 *
 * Deliberately does not touch `pending-directions.ts`'s turn-steering state
 * — that store is shared with every other dev-workspace e2e spec, and
 * resetting it here could clear an in-flight turn a concurrently running,
 * unrelated test depends on. Unavailable in production, like every other
 * `/api/dev/*` route.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  resetDevFields();
  resetDevProposals();
  return new NextResponse(null, { status: 204 });
}
