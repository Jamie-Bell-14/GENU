"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EditObjectSchema, type EditResult } from "@/lib/canvas/edit";

/**
 * Edits the text of a project object.
 *
 * A Server Action is a public mutation endpoint (SECURITY_STANDARDS §8):
 * authenticate, authorise the project, validate, then write — with RLS
 * underneath as the second layer. The object id is never trusted; the update
 * is constrained to rows inside the caller's project.
 */
export async function editProjectObject(
  projectId: string,
  input: unknown,
): Promise<EditResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      error: "The workspace is not connected to a database.",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Your session has ended. Sign in to continue." };
  }

  const parsed = EditObjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { objectId, kind, text } = parsed.data;

  // Ownership check in the service layer; a foreign or missing project is
  // indistinguishable to the caller.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return { ok: false, error: "That project is not available." };
  }

  /*
    The user is now the author of this text, so origin becomes user_stated.
    Support is deliberately not changed: rewording a claim is not evidence
    for it.
  */
  const table = kind === "field" ? "project_fields" : "assumptions";
  const column = kind === "field" ? "value" : "statement";

  const { error, count } = await supabase
    .from(table)
    .update({ [column]: text, origin: "user_stated" }, { count: "exact" })
    .eq("id", objectId)
    .eq("project_id", projectId);

  if (error) {
    return {
      ok: false,
      error: "The change could not be saved. Your text is unchanged.",
    };
  }
  if (count === 0) {
    return { ok: false, error: "That item is no longer available." };
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
