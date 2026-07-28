import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = {
  title: "Create account — Intelligent Product Lab",
};

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-medium">Create account</h1>
      <Suspense>
        <AuthForm mode="sign-up" />
      </Suspense>
      <p className="text-fg-secondary text-sm">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-brand underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
