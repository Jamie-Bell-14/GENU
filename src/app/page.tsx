import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export function Landing() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-xl flex-col items-start gap-3">
        <h1 className="font-display text-2xl font-medium">
          Intelligent Product Lab
        </h1>
        <p className="text-fg-secondary">
          Move from an uncertain problem to an evidence-backed product plan —
          through conversation, research and challenged decisions.
        </p>
        <div className="mt-2 flex gap-2">
          <Button asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sign-up">Create account</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/projects");
  return <Landing />;
}
