import { notFound } from "next/navigation";
import { DevWorkspace } from "./dev-workspace";
import { DEMO_OBJECTS, DEMO_RELATIONSHIPS } from "@/lib/dev/demo-project";

export default function DevWorkspacePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <DevWorkspace objects={DEMO_OBJECTS} relationships={DEMO_RELATIONSHIPS} />
  );
}
