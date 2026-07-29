import { NextResponse, type NextRequest } from "next/server";
import type { Message } from "@/lib/ai/turn-events";
import { loadActivityHistory } from "@/lib/services/activity";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Catch-up after a lost stream (docs/VERTICAL_SLICE_TASKS.md T8, "reconnect
 * mid-activity").
 *
 * An SSE connection can drop without either side deciding to end the turn. The
 * client cannot resume the byte stream, but it does not need to: everything
 * that mattered was recorded server-side under the turn id. This returns what
 * the server actually holds for that turn, so the workspace recovers without a
 * full page reload and without inventing anything it did not receive.
 *
 * Ids are stable — activity lines are keyed by turn and step, the assistant
 * message by its row id — so replaying this after a partial stream cannot
 * duplicate what the client already has.
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

  const [activity, assistant] = await Promise.all([
    loadActivityHistory(supabase, projectId, { turnId }),
    supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("project_id", projectId)
      .eq("turn_id", turnId)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const row = assistant.data as {
    id: string;
    content: string;
    created_at: string;
  } | null;

  const message: Message | null = row
    ? {
        id: row.id,
        role: "assistant",
        content: row.content,
        blockKind: "plain",
        createdAt: row.created_at,
      }
    : null;

  return NextResponse.json(
    { activity, message },
    { headers: { "cache-control": "no-store" } },
  );
}
