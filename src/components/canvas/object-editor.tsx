"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasObject } from "@/lib/canvas/model";
import { MAX_FIELD_VALUE, MAX_ASSUMPTION_STATEMENT } from "@/lib/canvas/edit";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export type EditSubmit = (
  object: CanvasObject,
  text: string,
) => Promise<{ ok: boolean; error?: string }>;

/**
 * Inline editing of the user's own meaning (docs/VERTICAL_SLICE_SPEC.md Step 2
 * acceptance). Editing is text-only: the user changes wording, never status,
 * support or structure — those move through the approval paths instead.
 */
export function ObjectEditor({
  object,
  onSubmit,
  onClose,
}: Readonly<{
  object: CanvasObject;
  onSubmit: EditSubmit;
  onClose: () => void;
}>) {
  const editable = object.editable;
  const [text, setText] = useState(editable?.text ?? "");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  if (!editable) return null;

  const limit =
    editable.kind === "assumption" ? MAX_ASSUMPTION_STATEMENT : MAX_FIELD_VALUE;
  const tooLong = text.length > limit;
  const unchanged = text.trim() === editable.text.trim();
  const canSave = text.trim().length > 0 && !tooLong && !unchanged;

  async function save() {
    if (!canSave) return;
    setStatus("saving");
    setError(null);
    const result = await onSubmit(object, text.trim());
    setStatus("idle");
    if (!result.ok) {
      // The user's text stays in the field so nothing is lost on failure.
      setError(result.error ?? "The change could not be saved.");
      return;
    }
    onClose();
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <Textarea
        ref={textareaRef}
        value={text}
        aria-label={`Edit ${object.title}`}
        aria-invalid={tooLong || undefined}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
        rows={3}
        className="min-h-20 text-sm"
      />
      {tooLong && (
        <p role="alert" className="text-state-error text-xs">
          {(text.length - limit).toLocaleString("en-GB")} characters over the
          limit. Shorten it to save.
        </p>
      )}
      {error && (
        <p role="alert" className="text-state-error text-xs">
          {error}
        </p>
      )}
      {object.origin !== "user_stated" && (
        // Editing inferred text makes the user its author; say so before they
        // commit rather than silently changing provenance.
        <p className="text-fg-tertiary text-xs">
          Saving marks this as your own wording rather than inferred.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="xs"
          onClick={save}
          disabled={!canSave || status === "saving"}
        >
          {status === "saving" && (
            <Spinner data-icon="inline-start" aria-hidden />
          )}
          Save
        </Button>
        <Button size="xs" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
