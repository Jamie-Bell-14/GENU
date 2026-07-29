import { NextResponse, type NextRequest } from "next/server";
import { loadActivityHistory } from "@/lib/services/activity";
import { readTurnSnapshot } from "@/lib/services/turn-snapshot";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Catch-up after a lost stream (docs/VERTICAL_SLICE_TASKS.md T8, "reconnect
 * mid-activity").
 *
 * An SSE connection can drop without either side deciding to end the turn. The
 * client cannot resume the byte stream, but it does not need to: everything
 * that mattered was recorded server-side under the turn id. This returns what
 * the server actually holds, together with **why** — a turn that is still
 * finishing, one that finished, one whose worker is gone, and a lookup that
 * failed are four different facts, and inferring "the turn did not finish"
 * from one empty read would be a false conclusion.
 *
 * State and result come from a single database statement, so a `completed`
 * status can never be paired with a result read that predates the insert.
 * Activity is read separately because it is additive and de-duplicated by
 * operation id, so a partial view of it cannot mislead.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; turnId: string }> },
) {
  const { projectId, turnId } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return new NextResponse(null, { status: 503 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  // RLS returns nothing for a foreign or nonexistent project; both answer 404.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return new NextResponse(null, { status: 404 });

  const [snapshot, activity] = await Promise.all([
    readTurnSnapshot(supabase, projectId, turnId),
    loadActivityHistory(supabase, projectId, { turnId }),
  ]);

  /*
    Only the authoritative snapshot can make this unresolved. A read that
    failed is reported as a failure rather than as an empty result, so the
    client can say "recovery failed" instead of telling the user their turn
    produced nothing.
  */
  if (snapshot.status === "lookup_failed") {
    return NextResponse.json(
      { status: "lookup_failed" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  /*
    Activity is narration. Its read failing must not withhold a result that the
    snapshot returned successfully — that would make best-effort history a
    precondition for recovering the user's actual answer. The failure is
    reported alongside instead.
  */
  return NextResponse.json(
    {
      status: snapshot.status,
      activity: activity.lines,
      activityUnavailable: activity.failed,
      message: snapshot.message,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
