import { NextResponse, type NextRequest } from "next/server";
import {
  applyChangeProposal,
  ChangeProposalActionRequestSchema,
  findOwnedProposalProjectId,
  undoChangeProposal,
} from "@/lib/services/change-proposals";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function errorResponse(
  code: "not_found" | "unavailable" | "unauthenticated" | "invalid_request",
  message: string,
  status: number,
) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Deciding a connected-change proposal (docs/VERTICAL_SLICE_TASKS.md T11,
 * docs/ARCHITECTURE.md §11): approve it — in full, partially, or as a
 * rejection when every item is excluded — or undo a decision already made.
 * Both actions live on this one route because they are the same resource's
 * two possible mutations, discriminated by the body's `action`.
 *
 * Deliberately thin: `apply_change_proposal`/`undo_change_proposal` do the
 * real work — ownership check, staleness check, the field/document/decision/
 * audit writes, all in one transaction — as the user-scoped client, not the
 * service-role trusted writer (SECURITY_STANDARDS.md §11.2: approval is
 * enforced by database state, not by this handler's own logic).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; changeId: string }> },
) {
  const { projectId, changeId } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return errorResponse(
      "unavailable",
      "The workspace is not connected to its database in this environment.",
      503,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(
      "unauthenticated",
      "Your session has ended. Sign in again to continue.",
      401,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const parsed = ChangeProposalActionRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(
      "invalid_request",
      parsed.error.issues[0].message,
      400,
    );
  }

  /*
    The URL names a project as well as a proposal; the RPCs below only check
    the proposal's own project against the caller, so this confirms the two
    agree before acting — a mismatched project in the path 404s instead of
    silently deciding a proposal that lives elsewhere. Relies on
    `change_proposals`' SELECT-only RLS policy, so it can never confirm a
    proposal this caller does not already own.
  */
  const ownedProjectId = await findOwnedProposalProjectId(supabase, changeId);
  if (ownedProjectId !== projectId) {
    return errorResponse("not_found", "That proposal is not available.", 404);
  }

  if (parsed.data.action === "approve") {
    const result = await applyChangeProposal(supabase, {
      proposalId: changeId,
      decisions: parsed.data.decisions,
    });
    switch (result.outcome) {
      case "completed":
        return NextResponse.json(result);
      case "conflict":
        return NextResponse.json({ error: result }, { status: 409 });
      case "not_found":
        return errorResponse(
          "not_found",
          "That proposal is not available.",
          404,
        );
      case "unavailable":
        return errorResponse(
          "unavailable",
          "This could not be recorded. Nothing has changed — try again.",
          503,
        );
    }
  }

  const result = await undoChangeProposal(supabase, changeId);
  switch (result.outcome) {
    case "completed":
      return NextResponse.json(result);
    case "conflict":
      return NextResponse.json({ error: result }, { status: 409 });
    case "not_found":
      return errorResponse("not_found", "That proposal is not available.", 404);
    case "unavailable":
      return errorResponse(
        "unavailable",
        "This could not be undone. Nothing has changed — try again.",
        503,
      );
  }
}
