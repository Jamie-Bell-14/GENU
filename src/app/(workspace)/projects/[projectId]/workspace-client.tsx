"use client";

import { useCallback } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { EditSubmit } from "@/components/canvas/object-editor";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import type { ActivityLine, Message } from "@/lib/ai/turn-events";
import type { ResearchFinding, ResearchSource } from "@/lib/research/types";
import { editProjectObject } from "./canvas-actions";

/**
 * Binds the edit Server Action to the shell. The action performs its own
 * authentication, authorisation and validation server-side — this wrapper only
 * adapts the call signature and never decides whether an edit is permitted.
 */
export function WorkspaceClient({
  projectId,
  projectName,
  initialMessages,
  initialActivity,
  activityTruncated,
  canvasObjects,
  canvasRelationships,
  initialResearch,
  initialEvidenceOutcome,
  initialPendingProposal,
}: Readonly<{
  projectId: string;
  projectName: string;
  initialMessages: Message[];
  initialActivity: ActivityLine[];
  activityTruncated: boolean;
  canvasObjects: CanvasObject[];
  canvasRelationships: ProjectRelationship[];
  initialResearch: {
    finding: ResearchFinding;
    turnId: string;
    unavailableSources: { source: ResearchSource; reason: string }[];
  } | null;
  /** A refused "Add as evidence" still current as of the last reload
   *  (T10 review round 4, P0-3). */
  initialEvidenceOutcome: { reason: string } | null;
  /** A connected-change proposal still awaiting review (T11). */
  initialPendingProposal: {
    id: string;
    title: string;
    rationale: string;
    affectedAreas: string[];
    affectedObjectIds: string[];
    turnId: string;
  } | null;
}>) {
  const onEditObject = useCallback<EditSubmit>(
    async (object, text) => {
      if (!object.editable) {
        return { ok: false, error: "This item cannot be edited." };
      }
      return editProjectObject(projectId, {
        objectId: object.id,
        kind: object.editable.kind,
        text,
      });
    },
    [projectId],
  );

  return (
    <WorkspaceShell
      projectId={projectId}
      projectName={projectName}
      initialMessages={initialMessages}
      initialActivity={initialActivity}
      activityTruncated={activityTruncated}
      canvasObjects={canvasObjects}
      canvasRelationships={canvasRelationships}
      initialResearch={initialResearch}
      initialEvidenceOutcome={initialEvidenceOutcome}
      initialPendingProposal={initialPendingProposal}
      onEditObject={onEditObject}
    />
  );
}
