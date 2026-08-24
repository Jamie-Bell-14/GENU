import { NextResponse, type NextRequest } from "next/server";
import {
  loadCanvasObjects,
  loadProjectRelationships,
} from "@/lib/canvas/project-model-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Re-reads project truth outside a turn (T11).
 *
 * Every earlier project-truth write happened inside a turn's own
 * `complete_turn` transaction, so the running SSE stream could tell the
 * canvas what changed (`project_model_updated`) the moment it committed.
 * Approving or undoing a connected-change proposal is the first write that
 * happens on its own request, with no turn or stream attached — this is the
 * same "re-read the application's own tables after the write landed" rule,
 * reached the same way a page load already reaches it, just from a client
 * component instead of a server one.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
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

  const [objects, relationships] = await Promise.all([
    loadCanvasObjects(supabase, projectId),
    loadProjectRelationships(supabase, projectId),
  ]);

  if (objects.failed || relationships.failed) {
    return new NextResponse(null, { status: 503 });
  }

  return NextResponse.json({
    objects: objects.data,
    relationships: relationships.data,
  });
}
