# Phase 0 Review Summary and Decision Sheet (archive)

> Status: **approved 2026-07-28**; decisions recorded in PROJECT_PLAN.md §17. Documents 04, 05 and 07 were promoted to docs/ARCHITECTURE.md, docs/VERTICAL_SLICE_TASKS.md and docs/SECURITY_REVIEW.md; the remaining files here are the review archive. Originally: Produced per CLAUDE_REVIEW_PROMPT.md with SECURITY_STANDARDS.md treated as mandatory throughout. No application code was written; no existing project file was modified; PROJECT_PLAN.md is untouched.

## Contents

| Document | Covers (prompt §) |
|---|---|
| 01-REPOSITORY_VERIFICATION.md | §1 — files, skills, missing references, locations |
| 02-SPECIFICATION_REVIEW.md | §2 — contradictions, risks, simplifications |
| 03-PLAN_MERGE_PROPOSAL.md | §3 — addendum → PROJECT_PLAN merge |
| 04-ARCHITECTURE_PROPOSAL.md | §4 — full architecture |
| 05-VERTICAL_SLICE_TASK_PLAN.md | §5 — 15 sequential tasks |
| 06-DESIGN_REVIEW.md | §6 — design direction with the three skills |
| 07-SECURITY_REVIEW.md | §8 — architecture vs SECURITY_STANDARDS.md |

## Decisions required before the merge and Phase 1 (the short list)

1. **Confidence representation** — recommend qualitative support states only; delete numeric `confidence_score` (02 §C2).
2. **AI pipeline granularity for the slice** — recommend one streaming tool-use call behind the `DiscoveryEngine` interface instead of PROJECT_PLAN §11's three separate calls per turn (02 §C6).
3. **Canvas dragging** — recommend deferring free object movement; keep pin/collapse/hide/re-centre/compare/undo (02 §U2).
4. **Slice authentication** — recommend minimal Supabase email+password with verified email (02 §P1).
5. **Missing skills referenced by DEVELOPMENT_STANDARDS** (`discovery-engine`, `founder-philosophy`, `supabase-standards`, `react-architecture`) — recommend marking deferred/removing references (01 §3).
6. **Source-of-truth order** — recommend CLAUDE.md §3 as canonical; DEVELOPMENT_STANDARDS defers to it (02 §C1).
7. **Font licensing** — license Helvetica Now + rounded companion, or ship slice on system stack with weight-marked display moments (02 §T5, 06 §2).
8. **Model + cost budget numbers** and an **incident-response owner name** (02 §P4, 07 §13).

## What happens on approval

1. Execute the merge into PROJECT_PLAN.md exactly as specified in 03 (one reviewed commit); delete PROJECT_PLAN_ADDENDUM.md; update the two cross-references (CLAUDE.md §2 note, DEVELOPMENT_STANDARDS source-of-truth section).
2. Begin T1 of 05-VERTICAL_SLICE_TASK_PLAN.md.
3. Remove or archive docs/review/ once its content is absorbed.
