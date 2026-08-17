import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WorkspaceClient } from "./workspace-client";
import type { Message } from "@/lib/ai/turn-events";
import {
  loadCanvasObjects,
  loadLatestResearchReceipt,
  loadProjectRelationships,
} from "@/lib/canvas/project-model-store";
import { loadActivityHistory } from "@/lib/services/activity";
import { loadLatestEvidenceOutcome } from "@/lib/services/turn-snapshot";
import {
  loadPendingProposal,
  loadLatestDecidedProposal,
} from "@/lib/services/change-proposals";

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
    .select("id, turn_id, role, content, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(200);

  const messages: Message[] = (rows ?? []).map((row) => ({
    id: row.id as string,
    turnId: row.turn_id as string,
    role: row.role as Message["role"],
    content: row.content as string,
    blockKind: "plain",
    createdAt: row.created_at as string,
  }));

  const [
    canvasObjects,
    canvasRelationships,
    activity,
    research,
    evidenceOutcome,
    pendingProposal,
    decidedProposal,
  ] = await Promise.all([
    loadCanvasObjects(supabase, projectId),
    loadProjectRelationships(supabase, projectId),
    // Activity recorded before this page load, so the history panel
    // survives a reload rather than starting empty (T8).
    loadActivityHistory(supabase, projectId),
    // The research receipt "Add as evidence" can still resolve, if it is
    // still what this project's conversation is actually about
    // (T10 review round 2, P0-A).
    loadLatestResearchReceipt(supabase, projectId),
    // A refused "Add as evidence" from the project's most recent turn,
    // recovered the same way a reload recovers a still-current research
    // receipt (T10 review round 4, P0-3) — otherwise only the stored,
    // staged assistant wording would survive a reload.
    loadLatestEvidenceOutcome(supabase, projectId),
    // A connected-change proposal still awaiting review (T11) — recovered
    // the same way a still-current research receipt is, so the in-stream
    // card survives a reload rather than only being reachable while the SSE
    // stream that created it stays open.
    loadPendingProposal(supabase, projectId),
    // The project's most recently *decided* proposal (issue #25) — recovered
    // the same way, so the outcome card and its Review changes/Undo actions
    // survive a reload rather than only existing in this session's memory.
    loadLatestDecidedProposal(supabase, projectId),
  ]);

  return (
    <WorkspaceClient
      projectId={project.id}
      projectName={project.name}
      initialMessages={messages}
      initialActivity={activity.lines}
      activityTruncated={activity.truncated}
      canvasObjects={canvasObjects.data}
      canvasRelationships={canvasRelationships.data}
      initialResearch={research}
      initialEvidenceOutcome={evidenceOutcome}
      initialPendingProposal={
        pendingProposal
          ? {
              id: pendingProposal.id,
              title: pendingProposal.title,
              rationale: pendingProposal.rationale,
              affectedAreas: pendingProposal.areas,
              affectedObjectIds: pendingProposal.objectIds,
              turnId: pendingProposal.turnId,
            }
          : null
      }
      initialProposalOutcome={
        decidedProposal
          ? {
              proposalId: decidedProposal.id,
              title: decidedProposal.title,
              status: decidedProposal.status,
              areas: decidedProposal.areas,
              viewRefreshed: true,
            }
          : null
      }
    />
  );
}
