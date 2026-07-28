"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server Actions are public mutation endpoints: authenticate, validate,
// and let RLS enforce ownership underneath (SECURITY_STANDARDS §8).
const CreateProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the project a name.")
    .max(120, "Keep the name under 120 characters."),
});

export interface CreateProjectResult {
  error: string | null;
}

export async function createProject(
  _previous: CreateProjectResult,
  formData: FormData,
): Promise<CreateProjectResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Authentication is not configured in this environment." };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const parsed = CreateProjectSchema.safeParse({
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { error } = await supabase
    .from("projects")
    .insert({ name: parsed.data.name, owner_id: user.id });
  if (error) {
    return {
      error:
        "The project could not be created. Your input is unchanged — try again.",
    };
  }
  revalidatePath("/projects");
  return { error: null };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/sign-in");
}
