import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WorkspaceClient } from "./workspace-client";
import type { Message } from "@/lib/ai/turn-events";
import {
  loadCanvasObjects,
  loadProjectRelationships,
} from "@/lib/canvas/project-model-store";

// Ownership-scoped project route rendering the workspace shell (T5).
export default async function ProjectPage({
  params,
}: Readonly<{ params: Promise<{ projectId: string }> }>) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/sign-in");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  // RLS returns no row for foreign and nonexistent projects alike, so both
  // resolve to the same 404 (no existence inference).
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const { data: rows } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(200);

  const messages: Message[] = (rows ?? []).map((row) => ({
    id: row.id as string,
    role: row.role as Message["role"],
    content: row.content as string,
    blockKind: "plain",
    createdAt: row.created_at as string,
  }));

  const [canvasObjects, canvasRelationships] = await Promise.all([
    loadCanvasObjects(supabase, projectId),
    loadProjectRelationships(supabase, projectId),
  ]);

  return (
    <WorkspaceClient
      projectId={project.id}
      projectName={project.name}
      initialMessages={messages}
      canvasObjects={canvasObjects}
      canvasRelationships={canvasRelationships}
    />
  );
}
