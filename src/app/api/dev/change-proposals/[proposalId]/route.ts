import { NextResponse, type NextRequest } from "next/server";
import {
  decideDevProposal,
  getDevProposal,
  undoDevProposal,
} from "@/lib/dev/pending-proposals";
import { ChangeProposalActionRequestSchema } from "@/lib/services/change-proposals";

export const runtime = "nodejs";

/**
 * Development-only mirror of `/api/projects/[projectId]/changes/[changeId]`:
 * the same request and response shapes, backed by the in-memory store in
 * `pending-proposals.ts` instead of `apply_change_proposal` /
 * `undo_change_proposal`. Unavailable in production — see that module's doc
 * for why an in-memory store is acceptable only here.
 */

function errorResponse(
  code: "not_found" | "invalid_request",
  message: string,
  status: number,
) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  const { proposalId } = await params;
  const proposal = getDevProposal(proposalId);
  if (!proposal) {
    return errorResponse("not_found", "That proposal is not available.", 404);
  }
  return NextResponse.json(proposal);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  const { proposalId } = await params;

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

  if (parsed.data.action === "approve") {
    const result = decideDevProposal(proposalId, parsed.data.decisions);
    if (result.outcome === "not_found") {
      return errorResponse("not_found", "That proposal is not available.", 404);
    }
    if (result.outcome === "conflict") {
      return NextResponse.json({ error: result }, { status: 409 });
    }
    return NextResponse.json(result);
  }

  const result = undoDevProposal(proposalId);
  if (result.outcome === "not_found") {
    return errorResponse("not_found", "That proposal is not available.", 404);
  }
  if (result.outcome === "conflict") {
    return NextResponse.json({ error: result }, { status: 409 });
  }
  return NextResponse.json(result);
}
