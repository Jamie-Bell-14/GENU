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
    unavailableSources: { source: ResearchSource; reason: string }[];
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
      onEditObject={onEditObject}
    />
  );
}
