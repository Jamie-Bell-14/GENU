"use client";

import { useCallback } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { EditSubmit } from "@/components/canvas/object-editor";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import type { Message } from "@/lib/ai/turn-events";
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
  canvasObjects,
  canvasRelationships,
}: Readonly<{
  projectId: string;
  projectName: string;
  initialMessages: Message[];
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
      canvasObjects={canvasObjects}
      canvasRelationships={canvasRelationships}
      onEditObject={onEditObject}
    />
  );
}
