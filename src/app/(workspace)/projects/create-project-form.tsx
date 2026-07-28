"use client";

import { useActionState } from "react";
import { createProject, type CreateProjectResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const initialState: CreateProjectResult = { error: null };

export function CreateProjectForm() {
  const [state, formAction, pending] = useActionState(
    createProject,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          name="name"
          aria-label="Project name"
          placeholder="Name a new project…"
          required
          maxLength={120}
          className="max-w-xs"
        />
        <Button type="submit" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" aria-hidden />}
          Create project
        </Button>
      </div>
      {state.error && (
        <p className="text-state-error text-sm" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
