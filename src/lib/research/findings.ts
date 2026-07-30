import type { ResearchFinding, ResearchSource } from "./types";

/**
 * The closed, application-owned research-finding catalogue for the slice's
 * one scripted scenario (VERTICAL_SLICE_SPEC §4: "MockResearchProvider
 * scripted tenancy-deposit research").
 *
 * A finding's `id` is the only thing that ever crosses back to the server
 * from a later turn (the "Add as evidence" flow, T10). Every provenance field
 * — source name, methodology, limitations, retrieval time — is re-derived
 * here from that id rather than trusted from anything the client sends,
 * exactly like a project field's origin is derived rather than asserted
 * (docs/AI_SYSTEM.md §2, §10). Sources are deliberately, plainly fictional
 * (VERTICAL_SLICE_SPEC §6: "fabricated sources must not look real").
 */

export const TENANCY_DEPOSIT_FINDING_ID = "tenancy-deposit-disputes-2024";

export const AVAILABLE_SOURCES: ResearchSource[] = [
  {
    id: "demo-scheme-annual-report",
    name: "Demonstration Deposit Protection Scheme — Illustrative Annual Report",
    url: null,
    retrievedAt: "",
  },
  {
    id: "demo-trade-body-survey",
    name: "Demonstration Letting Agency Trade Body — Illustrative Member Survey",
    url: null,
    retrievedAt: "",
  },
];

/** Scripted as unavailable every run (VERTICAL_SLICE_TASKS T10 edge case). */
export const UNAVAILABLE_SOURCE: ResearchSource = {
  id: "demo-regional-authority-bulletin",
  name: "Demonstration Regional Housing Authority — Illustrative Bulletin",
  url: null,
  retrievedAt: "",
};

/**
 * Builds the one scripted finding with its retrieval time stamped at the
 * moment it is actually produced — by a running research pass, or again when
 * evidence is added in a later turn — rather than a value frozen in this
 * catalogue (docs/VERTICAL_SLICE_TASKS.md T10: "retrieval time" is part of
 * honest provenance).
 */
/**
 * Re-derives a finding from its id alone (T10's "Add as evidence" flow —
 * nothing about a research run persists on the server between turns, so a
 * later turn re-fetches it here rather than trusting anything the client
 * sends back). `null` for any id outside this one-entry catalogue.
 */
export function findFindingById(id: string): ResearchFinding | null {
  if (id !== TENANCY_DEPOSIT_FINDING_ID) return null;
  return buildTenancyDepositFinding(new Date().toISOString());
}

export function buildTenancyDepositFinding(
  retrievedAt: string,
): ResearchFinding {
  const at = (source: ResearchSource): ResearchSource => ({
    ...source,
    retrievedAt,
  });
  return {
    id: TENANCY_DEPOSIT_FINDING_ID,
    title:
      "Deposit disputes are common, and concentrated among larger agencies",
    keyFinding:
      "In this scripted scenario, around 1 in 6 tenancy deposits ends in a dispute overall. The scheme's own annual report puts the figure at 18% for agencies managing over 500 properties, against 12% for agencies managing under 100 — but a separate trade-body survey estimates the overall rate at closer to 14%, using a narrower definition of “dispute”. The two do not agree, which is exactly why this is demonstration data rather than a settled number.",
    whyItMatters:
      "If dispute rates really do rise with agency size, a product aimed at smaller agencies is solving a problem that shows up less often for its own customers than it does for the market as a whole.",
    visualisation: {
      kind: "bar",
      unit: "% of deposits disputed",
      series: [
        { label: "Under 100 properties", value: 12 },
        { label: "100–500 properties", value: 15 },
        { label: "Over 500 properties", value: 18 },
      ],
    },
    sources: AVAILABLE_SOURCES.map(at),
    methodology:
      "Illustrative annual reporting, aggregated by agency size band, as published by an illustrative deposit protection scheme; compared against an illustrative trade-body member survey that uses a different dispute definition.",
    limitations:
      "Demonstration data only. Sample sizes for the smallest agency band are not published. The two sources define “dispute” differently, so the figures are not directly comparable. One further source could not be retrieved in this run.",
    retrievedAt,
    isDemo: true,
    conflicting: true,
  };
}
