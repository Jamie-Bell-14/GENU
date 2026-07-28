# DRAFT — Critical Specification Review (Phase 0 Review, Part 2)

> Status: draft proposal for review. Findings are ordered by consequence. Each finding states a recommendation; items marked **Decision required** cannot be resolved unilaterally.

## A. Contradictions

### C1. Two different source-of-truth orders — **Decision required**
DEVELOPMENT_STANDARDS.md ("Source of Truth") ranks: PROJECT_PLAN → DEVELOPMENT_STANDARDS → DESIGN → CLAUDE.md → skills, and omits SECURITY_STANDARDS entirely. CLAUDE.md §3 ranks: user instruction → SECURITY_STANDARDS → PROJECT_PLAN → DEVELOPMENT_STANDARDS → DESIGN → specs → skills.

**Recommendation:** adopt CLAUDE.md §3 as the single canonical order (security above product documents is the only defensible ordering) and replace the DEVELOPMENT_STANDARDS list with a reference to it.

### C2. Numeric confidence vs. qualitative confidence — **Decision required**
PROJECT_PLAN §4 mandates per-field `confidence_score` (e.g. `0.72`) and §12's Zod schema requires `confidence: z.number()`. VERTICAL_SLICE_SPEC Step 3 says "no numeric confidence percentage is required"; DESIGN.md §12 prohibits single completion percentages and defines qualitative states (Unexplored → Hypothesis → Some supporting evidence → Credible → Strongly evidenced / Contradicted); UI_ACCEPTANCE_CRITERIA prohibits arbitrary percentages.

**Recommendation:** drop numeric confidence from the data model entirely and store the qualitative support state. LLM-emitted numeric confidences are not calibrated — they manufacture false precision, the exact failure DESIGN.md §2.3 warns against. Displaying words while storing misleading numbers would keep the cost and lose the honesty. The architecture (04) and schema reflect this recommendation.

### C3. Broad MVP vs. vertical slice
PROJECT_PLAN §2–§3 commit to six entry paths, ten stages and full artefact generation; the addendum §C explicitly replaces this with one vertical journey. The merge resolves the headline conflict, but residue remains: §15 (phases 1–7), §16 (17-step order) and §17 (first instruction) all still describe the broad build. **Recommendation:** restructure phases during the merge (03-PLAN_MERGE_PROPOSAL.md §2, items M6–M9) rather than inserting Phase 0–2 alongside contradictory phases.

### C4. Three-panel "project model" vs. living canvas
PROJECT_PLAN §8 defines a right panel showing a live project model with confidence indicators; DESIGN.md §3 defines a living canvas with six controlled modes plus planning navigation. These are different products in the same slot. **Recommendation:** DESIGN.md wins (newer, more specific, referenced by the addendum as design source of truth); replace PROJECT_PLAN §8's layout with a reference to DESIGN.md §3.

### C5. Research in the MVP
PROJECT_PLAN §14 says do not add external web research unless sources can be clearly attributed; the vertical slice requires a research flow at its centre. These reconcile only through the spec's own device: a **mocked ResearchProvider with explicitly labelled demonstration data** for the slice, and real retrieval deferred until the SECURITY_STANDARDS §11.3 controls (SSRF guards, allow-listed schemes, redirect validation, size limits) are built. The merge should state this explicitly so the tension does not resurface.

### C6. Multi-call AI pipeline vs. slice latency — **Decision required**
PROJECT_PLAN §11 mandates separate model operations (extract → evaluate → respond) per user message. For the interactive slice this means 3× latency and 3× cost on every turn before the user sees a word. **Recommendation:** keep the *interface* boundary (`DiscoveryEngine`) exactly as specified, but implement the slice as **one streaming Claude call using tool-use** (tools: `update_project_model`, `propose_connected_change`, `start_research`, `suggest_checkpoint`), with all tool inputs validated and applied by application code. Split into separate operations later if extraction quality demands it — the interface makes that swap invisible to the UI. This preserves §11's real intent (no giant unvalidated prompt, no free-form DB writes) while making the slice responsive.

## B. Duplicated requirements

- **UI acceptance criteria** appear in four places: DEVELOPMENT_STANDARDS ("UI Acceptance Criteria"), addendum §H, docs/UI_ACCEPTANCE_CRITERIA.md, CLAUDE.md §8. Canonicalise on docs/UI_ACCEPTANCE_CRITERIA.md; the others should reference it.
- **Anti-pattern lists** (purple gradients, glowing orbs, fake analytics…) appear in PROJECT_PLAN §9, DESIGN.md §21, DEVELOPMENT_STANDARDS, CLAUDE.md §8. Canonicalise on DESIGN.md §21.
- **Deferred-scope lists** appear in addendum §G, VERTICAL_SLICE_SPEC §7, CLAUDE.md §7, DESIGN.md §20. Canonicalise on the merged PROJECT_PLAN deferred-scope section.
- **Task templates** are defined in PROJECT_PLAN §13, addendum §D.4 and CLAUDE_REVIEW_PROMPT §5 with slightly different field lists. Use one template (the §5 superset) everywhere.

## C. Unrealistic requirements and unnecessary complexity

### U1. The 24-field ProjectProfile schema is premature
PROJECT_PLAN §4 specifies ~24 profile fields, each carrying value/confidence/evidence/sources/status. The vertical slice touches perhaps five areas (problem, customer, value proposition, MVP scope, evidence). Building the full schema now creates migration churn with no user-visible benefit. **Recommendation:** a generic `project_fields` design (area + key + value + state) that can grow to the full profile without schema changes (04 §6).

### U2. Free spatial canvas dragging — **Decision required**
DESIGN.md §3.4 grants "move visible objects" in the initial version. Free object movement implies a spatial layout engine, drag persistence, collision handling, and a non-drag accessibility equivalent for every operation — a large fraction of a whiteboard product, for the least proof-bearing part of the loop. **Recommendation:** for the slice, implement the canvas as a structured, zoned layout (current subject prominent, related objects grouped, project outline minimised) with **pin, collapse, hide, re-centre, compare and undo** — everything in §3.4 *except* free movement, which moves to deferred scope. This keeps the "AI maintains the structure" principle literal and removes the largest accessibility and complexity risk in the slice.

### U3. Full visual-regression infrastructure in the slice
UI_ACCEPTANCE_CRITERIA §13 asks for visual regression coverage of core workspace states. Standing up a visual-regression service is disproportionate for a pre-approval slice. **Recommendation:** Playwright screenshot assertions on a small set of stable shell states in CI; adopt a dedicated visual-regression tool post-slice.

### U4. Fifteen discovery action types and ten stages
Needed eventually; not needed for a problem-first slice that exercises perhaps six of them. Keep the enums extensible, implement only what the journey exercises.

## D. Weak technical assumptions

- **T1 — LLM numeric confidence** (see C2): uncalibrated, presents as precision.
- **T2 — "Server actions or route handlers" left undecided.** Token streaming and activity events need a streaming response; Server Actions cannot stream incrementally. Decision made in 04: route handlers (SSE) for turns/research, Server Actions only for simple non-streaming mutations — and treated as public endpoints per SECURITY_STANDARDS §8.
- **T3 — Transactional connected changes via supabase-js.** PostgREST calls cannot be composed into one transaction from the client library. Connected-change apply/undo must be Postgres functions (RPC) or it will violate SECURITY_STANDARDS §7.4/§11.4 (partial writes). This is load-bearing and is designed in 04 §11.
- **T4 — Undo as an afterthought.** "Undone as one action" requires before-values captured at apply time and append-only versions. If the version model is not designed first, undo becomes destructive. Designed in 04 §12.
- **T5 — Helvetica Now availability.** DESIGN.md prefers a commercial font; UI_ACCEPTANCE prohibits bundling unlicensed fonts; the fallback "Arial Rounded MT Bold" is effectively macOS-only. **Decision required:** either license Helvetica Now (+ choose a licensed rounded display face) or ship the slice on the system Helvetica/Arial stack with a deliberately chosen free rounded display (used only in the narrow moments DESIGN.md §6.1 permits).
- **T6 — Observable activity provenance.** The spec's activity lines ("Searching official tenancy-deposit sources…") must be **generated by application code from real orchestration events**, never by the model narrating itself — a model can claim work it did not do, which would violate UI_ACCEPTANCE §7 ("No fabricated source or operation"). Architecture treats activity as server-emitted events only.

## E. Missing product decisions — **all Decision required**

- **P1 — Authentication scope of the slice.** The vertical slice spec never mentions sign-in, yet it persists real project data, and SECURITY_STANDARDS §7.1 requires RLS (which presupposes authenticated users) before production data. Recommendation: minimal Supabase Auth (email + password, verified email) in the slice; no OAuth/MFA yet.
- **P2 — Font licensing** (T5 above).
- **P3 — Eventual research provider** (Anthropic web search tool, Brave, Tavily…). Not needed for the slice, but the `ResearchProvider` contract in 04 §9 should be confirmed against at least one intended real provider.
- **P4 — Model and per-turn cost budget.** Which Claude model for conversation turns, max tokens per turn, monthly budget alert thresholds (SECURITY_STANDARDS §17).
- **P5 — Layout-preference persistence.** DESIGN.md says the product remembers layout. Recommendation: localStorage for the slice (no schema, no sync); DB-backed preferences post-slice.
- **P6 — Single project vs. dashboard in the slice.** Spec starts at the opening screen. Recommendation: slice supports multiple projects trivially (a plain project list), but no dashboard design investment; DESIGN.md §19 returning-user logic deferred.

## F. Missing architecture decisions
Resolved by proposals in 04 (listed here for visibility): streaming transport (SSE), turn event vocabulary, error model, prompt versioning, RLS helper-function pattern, mock/real service seams, rate limiting mechanism, CSP strategy.

## G. Accessibility risks

1. **Canvas semantics.** A visual canvas with no DOM order story is unreadable to screen readers. Mitigation: the zoned canvas (U2) renders as ordered, labelled regions — genuine list/region semantics, not absolutely-positioned divs.
2. **Live-activity announcement flooding.** Streaming activity into `aria-live` verbatim will spam screen readers. Mitigation: polite region announcing only phase transitions and the completion summary.
3. **Drag interactions** (avoided by U2; any remaining reorder gets keyboard equivalents).
4. **Three-panel keyboard topology.** Needs landmarks, skip links, and panel-focus shortcuts; resizable divider needs `role="separator"` with arrow-key resizing.
5. **Status-by-colour.** Tokens define colour semantics; every state must also carry a text label/icon (UI_ACCEPTANCE §11) — enforced in the object grammar components, not per-screen.
6. **Charts** need data-table/text alternatives from the first research visual.

## H. Performance risks

1. Per-turn model latency (addressed by C6 single-call + streaming).
2. Canvas re-render on every model update — memoised object components keyed by node id; updates arrive as discrete events, not full refetches.
3. Conversation context growth — context window strategy: recent messages + compact structured model summary, not full transcript replay.
4. Document regeneration — documents update by targeted section edits (change items), never whole-document regeneration per turn.
5. SSE connections held open during research — bounded duration, resumable via activity history on reconnect.

## I. Data-model risks
Covered in 04: append-only versions/audit (tamper resistance), ownership immutability, evidence-link integrity, `is_demo` flag on evidence so demonstration data can never silently masquerade as real (VERTICAL_SLICE_SPEC §6), transactional connected changes (T3), qualitative state enums (C2).

## J. AI-orchestration risks

1. **Prompt injection** — user messages are the only untrusted model input in the slice (mock research removes retrieved-content injection until real research lands with §11.3 controls). Untrusted content is delimited and labelled; tool calls are validated and authorised independently of model text.
2. **Fabricated activity/sources** (T6) — activity is app-emitted; mock sources are visibly labelled "Demonstration data".
3. **Approval bypass by reformulation** — approval is enforced by the change-proposal state machine in the database, not by prompt instructions; there is no tool that writes structural fields directly.
4. **Schema-invalid output loops** — one retry with schema feedback, then fail safe preserving the user's message (PROJECT_PLAN §12 + SECURITY_STANDARDS §11.4).
5. **Cost abuse** — per-user turn rate limits, per-turn token caps, max tool steps per turn, budget alerts (SECURITY_STANDARDS §17).

## K. Visual/cognitive overload risks

- Conversation + canvas + activity + contextual actions can all demand attention at once. Mitigations already latent in the documents, made binding in 06: one dominant interactive object per AI turn; activity subtle and ignorable; max three contextual actions; canvas still while reading; connected-change review in a focused overlay rather than a fourth panel.
- The connected-change diff is the densest surface in the slice; 06 §6 proposes a single-column, per-item review sheet instead of side-by-side diffs.

## L. Vertical-slice simplifications (summary of recommendations)

1. Canvas: zoned structured layout; no free dragging (U2). **Decision required.**
2. One streaming tool-use call per turn behind `DiscoveryEngine` (C6). **Decision required.**
3. Qualitative support states; no numeric confidence anywhere (C2). **Decision required.**
4. Research: mock provider only, honestly labelled; real retrieval deferred (C5).
5. Four living documents only: Problem definition, Target customer, Value proposition, MVP scope.
6. Minimal auth: email + password (P1). **Decision required.**
7. Milestones as named version rows; per-field before/after review, no rich diff rendering.
8. No analytics/monitoring products in the slice; structured server logs with redaction. Sentry/PostHog revisited post-slice with SECURITY_STANDARDS §13/§15 constraints.
