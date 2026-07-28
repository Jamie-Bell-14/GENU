# DRAFT — PROJECT_PLAN merge proposal (Phase 0 Review, Part 3)

> Status: draft. PROJECT_PLAN.md has **not** been modified. This document specifies exactly what the merge will do once approved.

## 1. Sections to insert (from PROJECT_PLAN_ADDENDUM.md)

| # | Addendum section | Insert location in PROJECT_PLAN.md |
|---|---|---|
| M1 | §A Product Experience North Star | Immediately after "## 1. Product vision" |
| M2 | §B Design Source of Truth | Immediately after the "Development Standards" section — which is also amended to add **SECURITY_STANDARDS.md** (currently missing from the list) |
| M3 | §C Initial Build Strategy | New section before "## 2. MVP objective"; §2 is retitled "Longer-term MVP objective (post-slice roadmap)" |
| M4 | §D Phase 0 | At the head of "## 15. MVP development phases" |
| M5 | §G Deferred scope | After the phases; becomes the **canonical** deferred-scope list |

## 2. Sections to replace

| # | PROJECT_PLAN section | Replacement |
|---|---|---|
| M6 | §15 Phase 1 "Foundation" + Phase 2 "Static discovery prototype" | Re-sequenced phases: **Phase 1 — Foundation** (repo, tooling, Supabase, auth, base schema/RLS, CI — retained from the old Phase 1), **Phase 2 — Design System and Workspace Shell** (addendum §E), **Phase 3 — First Complete Vertical Journey** (addendum §F). Old phases 3–7 are retitled "Post-slice roadmap phases" and kept for reference. The old Phase 2 (mocked static prototype) is deleted — the addendum's shell + mock-engine seam supersedes it |
| M7 | §16 Initial implementation order | Replaced with the vertical-slice task sequence (05-VERTICAL_SLICE_TASK_PLAN.md), which preserves §16's per-item completion discipline |
| M8 | §17 First Claude Code instruction | Replaced with a short pointer: Phase 0 is defined by CLAUDE_REVIEW_PROMPT.md and completed by the approved docs/review/ output |
| M9 | §8 User interface (three-panel description) | Replaced with a reference to DESIGN.md §3 (planning navigation + adaptive editorial conversation + living canvas). The mobile note is kept but marked deferred |
| M10 | Addendum §H per-task UI checklist | Inserted as a one-line reference to docs/UI_ACCEPTANCE_CRITERIA.md rather than the full duplicate list (see §4 below) |

## 3. Conflicts that require a decision before merging

These mirror 02-SPECIFICATION_REVIEW.md; the merge cannot be executed until each is decided:

1. **Confidence representation** (C2): merge will either delete `confidence_score`/numeric Zod fields from §4/§12 in favour of qualitative support states (recommended), or keep numbers internally. Affects M6 wording and the schema in 04.
2. **AI pipeline granularity** (C6): §11's four-operation pipeline is retitled "AI operation boundaries" with a note that the slice implements A+B+C as one streaming tool-use call behind `DiscoveryEngine` (recommended), or kept as literal separate calls.
3. **Canvas dragging** (U2): "move visible objects" moves to deferred scope (recommended) or stays in slice scope.
4. **Slice authentication** (P1): Phase 1 includes minimal email+password auth (recommended) or the slice runs unauthenticated behind a flag.
5. **Missing skills** (Verification §3): DEVELOPMENT_STANDARDS references to `discovery-engine`, `founder-philosophy`, `supabase-standards`, `react-architecture` are marked deferred/removed (recommended) or the skills are created first.
6. **Source-of-truth order** (C1): CLAUDE.md §3 becomes canonical and DEVELOPMENT_STANDARDS defers to it (recommended).

## 4. Wording to simplify during the merge

- Collapse the four duplicated UI-acceptance lists to one canonical file (docs/UI_ACCEPTANCE_CRITERIA.md) with references elsewhere.
- Collapse the four anti-pattern lists to DESIGN.md §21 with references.
- Collapse the four deferred-scope lists to the merged PROJECT_PLAN section with references.
- Unify the three task templates on the CLAUDE_REVIEW_PROMPT §5 field list.
- §14 Security and privacy: replace the ad-hoc bullet list with a pointer to SECURITY_STANDARDS.md plus only the product-specific notes (research attribution rule, AI-content indicators).

## 5. Merge mechanics

- Executed as a single reviewed commit touching PROJECT_PLAN.md (and the small cross-reference edits in DEVELOPMENT_STANDARDS.md and CLAUDE.md §2's temporary addendum note).
- After the merge is approved and committed, PROJECT_PLAN_ADDENDUM.md is deleted (its content is fully absorbed) and CLAUDE.md §2's "temporary planning-update stage" sentence is removed.
- CLAUDE.md §16 (review instruction) is removed only when you explicitly approve starting Phase 1.
