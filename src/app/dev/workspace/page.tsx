import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

// Dev-only route: the workspace shell with a stub project, reviewable and
// testable without Supabase credentials. Unavailable in production.
export default function DevWorkspacePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <WorkspaceShell projectId="demo" projectName="Deposit disputes (demo)" />
  );
}
