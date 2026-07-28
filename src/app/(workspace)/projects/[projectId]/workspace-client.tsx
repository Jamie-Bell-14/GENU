"use client";

import { useCallback } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { EditSubmit } from "@/components/canvas/object-editor";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import type { ActivityLine, Message } from "@/lib/ai/turn-events";
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
  canvasObjects,
  canvasRelationships,
}: Readonly<{
  projectId: string;
  projectName: string;
  initialMessages: Message[];
  initialActivity: ActivityLine[];
  canvasObjects: CanvasObject[];
  canvasRelationships: ProjectRelationship[];
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
      canvasObjects={canvasObjects}
      canvasRelationships={canvasRelationships}
      onEditObject={onEditObject}
    />
  );
}
