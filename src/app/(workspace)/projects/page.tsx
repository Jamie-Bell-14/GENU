import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { signOut } from "./actions";
import { CreateProjectForm } from "./create-project-form";

export const metadata: Metadata = {
  title: "Projects — Intelligent Product Lab",
};

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

export default async function ProjectsPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/sign-in");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  const projects = (data ?? []) as ProjectRow[];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-medium">Projects</h1>
        <form action={signOut}>
          <Button variant="ghost" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      <CreateProjectForm />

      {error ? (
        <p className="text-state-error text-sm" role="alert">
          Projects could not be loaded right now. The list below may be
          incomplete — reload to try again.
        </p>
      ) : projects.length === 0 ? (
        <p className="text-fg-secondary">
          No projects yet. Name one above to begin — the discovery workspace
          opens from here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge-subtle rounded-md border border-edge-subtle bg-surface-primary">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="flex items-baseline justify-between gap-4 p-4 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-edge-focus"
              >
                <span className="font-medium">{project.name}</span>
                <span className="text-fg-tertiary font-mono text-xs">
                  {new Date(project.created_at).toLocaleDateString("en-GB")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
