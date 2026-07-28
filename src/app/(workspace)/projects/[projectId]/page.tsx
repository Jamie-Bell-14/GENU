import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Minimal project route: proves ownership-scoped access end to end.
// The workspace shell replaces this surface in task T5.
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-8">
      <h1 className="font-display text-2xl font-medium">{project.name}</h1>
      <p className="text-fg-secondary">
        The discovery workspace for this project arrives with the workspace
        shell (task T5).
      </p>
    </main>
  );
}
