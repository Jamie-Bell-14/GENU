"use client";

import { useCallback, useState } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { EditSubmit } from "@/components/canvas/object-editor";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import { EditObjectSchema } from "@/lib/canvas/edit";

/**
 * Development-only host. Edits apply to in-memory demonstration data through
 * the same validation schema the Server Action uses, so the interaction is
 * reviewable without a database. Nothing here persists, and this route is
 * unavailable in production.
 */
export function DevWorkspace({
  objects: initialObjects,
  relationships,
}: Readonly<{
  objects: CanvasObject[];
  relationships: ProjectRelationship[];
}>) {
  const [objects, setObjects] = useState(initialObjects);

  const onEditObject = useCallback<EditSubmit>(async (object, text) => {
    if (!object.editable) {
      return { ok: false, error: "This item cannot be edited." };
    }
    const parsed = EditObjectSchema.safeParse({
      objectId: object.id,
      kind: object.editable.kind,
      text,
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0].message };
    }
    setObjects((current) =>
      current.map((candidate) =>
        candidate.id === object.id
          ? {
              ...candidate,
              // Mirrors the server rule: edited text is the user's own wording.
              origin: "user_stated",
              ...(candidate.editable?.kind === "assumption"
                ? { title: text }
                : { detail: text }),
              editable: candidate.editable
                ? { ...candidate.editable, text }
                : undefined,
            }
          : candidate,
      ),
    );
    return { ok: true };
  }, []);

  return (
    <WorkspaceShell
      projectId="demo"
      projectName="Deposit disputes (demo)"
      canvasObjects={objects}
      canvasRelationships={relationships}
      onEditObject={onEditObject}
    />
  );
}
