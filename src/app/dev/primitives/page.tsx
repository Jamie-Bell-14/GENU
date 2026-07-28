import { notFound } from "next/navigation";
import { PrimitivesReview } from "./primitives-review";

// Dev-only surface for reviewing the re-themed primitives in every state and
// both themes (T3 acceptance). Not part of the product; unavailable in
// production builds.
export default function PrimitivesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PrimitivesReview />;
}
