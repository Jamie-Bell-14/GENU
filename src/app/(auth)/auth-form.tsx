"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Mode = "sign-in" | "sign-up";

interface FormState {
  status: "idle" | "submitting" | "sent-confirmation";
  error: string | null;
}

/**
 * Error wording avoids account enumeration: sign-in failures never say
 * whether the email exists (SECURITY_STANDARDS §5).
 */
function describeAuthError(mode: Mode, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "That email and password combination was not accepted. Check both and try again, or reset your password.";
  }
  if (normalized.includes("email not confirmed")) {
    return "This email address has not been verified yet. Use the link in the verification email, then sign in.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Too many attempts. Wait a minute before trying again.";
  }
  if (mode === "sign-up" && normalized.includes("password")) {
    return "The password does not meet the requirements. Use at least 8 characters.";
  }
  return "The request could not be completed. Your input is unchanged — try again.";
}

export function AuthForm({ mode }: Readonly<{ mode: Mode }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<FormState>({
    status: "idle",
    error: null,
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setState({
        status: "idle",
        error:
          "Authentication is not configured in this environment. Set the Supabase environment variables and restart.",
      });
      return;
    }

    setState({ status: "submitting", error: null });
    if (mode === "sign-in") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setState({
          status: "idle",
          error: describeAuthError(mode, error.message),
        });
        return;
      }
      router.replace(searchParams.get("next") ?? "/projects");
      router.refresh();
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/sign-in` },
      });
      if (error) {
        setState({
          status: "idle",
          error: describeAuthError(mode, error.message),
        });
        return;
      }
      setState({ status: "sent-confirmation", error: null });
    }
  }

  if (state.status === "sent-confirmation") {
    return (
      <div className="flex flex-col gap-2" role="status">
        <h2 className="text-lg font-medium">Check your email</h2>
        <p className="text-fg-secondary text-sm">
          A verification link is on its way. Open it, then sign in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={
              mode === "sign-in" ? "current-password" : "new-password"
            }
            required
            minLength={8}
            maxLength={128}
          />
          {mode === "sign-up" && (
            <FieldDescription>At least 8 characters.</FieldDescription>
          )}
        </Field>
      </FieldGroup>
      {state.error && (
        <p className="text-state-error text-sm" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={state.status === "submitting"}>
        {state.status === "submitting" && (
          <Spinner data-icon="inline-start" aria-hidden />
        )}
        {mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
