import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = {
  title: "Sign in — Intelligent Product Lab",
};

export default function SignInPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-medium">Sign in</h1>
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
      <p className="text-fg-secondary text-sm">
        New here?{" "}
        <Link
          href="/sign-up"
          className="text-brand underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
