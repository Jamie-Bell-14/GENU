# Architecture

> Status: **approved** (Phase 0 review, 2026-07). Security analysis of this architecture is in docs/SECURITY_REVIEW.md. Numbered references like "02 §U1" point to the Phase 0 review archive in docs/review/. ⚑ marks formerly open decisions — all were approved as recommended (see PROJECT_PLAN.md §17). The incident-response owner is recorded (§17); AI cost controls were resolved on 2026-07-29 in §17.1, which sets per-turn caps as engineering defaults and defers the monthly provider budget and per-user fair-use quota with approval.

## 1. Repository structure

Next.js App Router application at the repository root, `src/` layout:

```text
src/
  app/
    (auth)/sign-in/  sign-up/            # minimal Supabase auth screens ⚑P1
    (workspace)/
      projects/page.tsx                  # plain project list (no dashboard design)
      projects/[projectId]/page.tsx      # workspace: opening state or journey
    api/projects/[projectId]/
      turns/route.ts                     # POST → SSE stream (conversation turn)
      research/route.ts                  # POST start · PATCH steer · DELETE stop
      changes/[changeId]/route.ts        # POST approve (with inclusions) · POST undo
  components/
    ui/            # shadcn primitives, re-themed to semantic tokens
    workspace/     # shell, planning nav, resizable divider, settings controls
    conversation/  # editorial stream, turn blocks, composer, action row
    canvas/        # zoned canvas, object grammar components, mode views
    documents/  decisions/  activity/  research/
  lib/
    ai/            # ONLY place @anthropic-ai/sdk is imported
      discovery-engine.ts  prompts/  tools/  schemas/
    research/      # ResearchProvider interface + mock/ (later real/)
    services/      # project-model-store, change-proposals, documents,
                   # decisions, activity, audit  (all server-only)
    supabase/      # server client, browser client, middleware helpers
    validation/    # shared Zod schemas, input limits
    errors.ts  rate-limit.ts  logger.ts
  styles/
    design-tokens.css  globals.css
supabase/
  migrations/      # versioned SQL incl. RLS policies and RPCs
  tests/           # RLS isolation tests (two-user)
tests/e2e/         # Playwright journey + axe
docs/              # existing documents; docs/review/ removed after approval
```

Provider isolation: `@anthropic-ai/sdk` appears only in `lib/ai`; `supabase-js` only in `lib/supabase` + services; components never import either.

## 2. Route structure

- `/` → signed-out: marketing-free opening explanation + sign-in; signed-in: redirect to single project or `/projects`.
- `/sign-in`, `/sign-up`.
- `/projects` — plain list + create.
- `/projects/[projectId]` — the workspace. Internal views (research view, document view, decision view, history) are **workspace states, not page navigations**, encoded in query params (`?view=document&id=…`) so they deep-link without unmounting the shell (DESIGN.md §2.4 structural stability).
- API route handlers as in §1; no other public endpoints.

## 3. Component architecture

- **Shell**: `WorkspaceShell` (server component frame) → `PlanningNav`, `ConversationPane`, `CanvasPane`, `ResizableDivider`, `ActivityControl`, `SettingsMenu`.
- **Conversation**: `ConversationStream` (editorial turns; not bubbles) renders a discriminated union of turn blocks: `PlainTurn`, `ChallengeBlock`, `ResearchFindingBlock`, `AssumptionBlock`, `ProposalBlock`, `CheckpointBlock`, `OutcomeSummaryBlock`. `Composer` (adaptive placeholder + attachment placeholder disabled-out-of-scope? No — no dead controls: attachment control omitted until uploads exist). `ContextualActionRow` (max 3, stable position).
- **Canvas**: `LivingCanvas` renders zones (current subject, related concepts, evidence, assumptions, project outline) from a view-model; object components `ConceptNode`, `EvidenceObject`, `AssumptionObject`, `DecisionObject`, `DocumentObject`, `VisualisationObject` share one `CanvasObjectFrame` (status rail, labels, 8px radius). Mode views: `ExplorationView`, `ResearchView`, `DocumentView`, `DecisionView`, `ComparisonView` — controlled switches, ⚑U2 no free dragging.
- **Change review**: `ChangeProposalSheet` — focused overlay listing per-item before/after with include/exclude and inconsistency warnings.
- All object/state components take their status from enums and render label + colour + icon (never colour alone).

## 4. Server/client component boundaries

- Server: shell frame, initial project snapshot (model, documents, decisions, recent messages) fetched with the user-scoped Supabase server client.
- Client: everything interactive — stream consumption, canvas, composer, review sheet, settings.
- Mutations: **route handlers for anything streaming or long-running** (turns, research); Server Actions permitted only for small, non-streaming mutations (rename project, pin/hide object) and treated as public endpoints: session check + ownership check + Zod validation in every one (SECURITY_STANDARDS §8).

## 5. State management

- **Server state**: TanStack Query for project model, documents, decisions, activity history; invalidated by turn-stream events.
- **Turn state**: a reducer consuming SSE `TurnEvent`s (below); optimistic user message append; no polling.
- **UI preferences** (theme, density, motion, text size, panel layout): localStorage + `data-*` attributes on `<html>` ⚑P5; a small context, no state library.
- No Redux/Zustand initially; introduce only with demonstrated need (CLAUDE.md §11 no speculative infrastructure).

## 6. Supabase schema (slice scope) ⚑C2

```sql
projects           (id, owner_id → auth.users, name, status, created_at, updated_at)
messages           (id, project_id, turn_id, role user|assistant, content, created_at)
project_fields     (id, project_id, area problem|customer|value_proposition|mvp_scope|…,
                    key, value jsonb, origin user_stated|ai_inferred|researched,
                    support unexplored|hypothesis|some_evidence|credible|strongly_evidenced|contradicted,
                    updated_at)                       -- qualitative only, no numeric confidence
evidence           (id, project_id, title, summary, source_name, source_url,
                    retrieved_at, methodology, limitations,
                    kind user_stated|secondary_research|customer_reported|observed|commitment,
                    is_demo boolean NOT NULL,          -- demonstration data is always marked
                    created_at)
evidence_links     (id, evidence_id, target_type field|assumption|decision, target_id)
assumptions        (id, project_id, statement, why_it_matters, alternatives jsonb,
                    status open|supported|weakened|invalidated, importance low|material,
                    created_at, updated_at)
change_proposals   (id, project_id, title, rationale, proposed_by ai|user,
                    status proposed|approved|partially_approved|rejected|undone,
                    created_at, decided_at)
change_items       (id, proposal_id, target_type field|document_section, target_ref jsonb,
                    before jsonb, after jsonb, included boolean, applied_at)
documents          (id, project_id, slug problem_definition|target_customer|value_proposition|mvp_scope,
                    title, current_version_id)
document_versions  (id, document_id, content jsonb,    -- sections with per-section state
                    origin ai_auto|ai_approved|user, change_proposal_id, milestone_name,
                    created_at)                        -- append-only
decisions          (id, project_id, title, reasoning_summary, alternatives jsonb,
                    remaining_uncertainty, proposed_by, approved_by → auth.users,
                    change_proposal_id, created_at)    -- append-only
decision_evidence  (decision_id, evidence_id)
activity_events    (id, project_id, turn_id, kind research_step|model_update|document_update|
                    steering|error, label, detail jsonb, created_at)
audit_events       (id, project_id, actor_id, action, target_type, target_id,
                    approval_state, detail jsonb, created_at)  -- append-only, no user UPDATE/DELETE
```

Constraints: FKs everywhere, `NOT NULL` defaults, enums as Postgres types or CHECKs, `documents(project_id, slug)` unique, indexes on every `project_id` (RLS hot path) and `proposal_id`, `document_id`.

Grows to PROJECT_PLAN §4's full profile by adding `area`/`key` values — no migration churn (02 §U1).

## 7. Row-Level Security approach

- RLS enabled on **every** table above before any real data; deny by default.
- Helper: `private.is_project_owner(p_project_id uuid) returns boolean` — `security definer`, `stable`, in a non-exposed schema; all child-table policies call it (SECURITY_STANDARDS §7.1).
- Explicit per-command policies. Highlights:
  - `projects`: owner-only SELECT/INSERT/UPDATE/DELETE; `owner_id` immutable (`WITH CHECK owner_id = auth.uid()` + trigger rejecting owner change).
  - `document_versions`, `decisions`, `audit_events`, `activity_events`: SELECT + INSERT only — **no UPDATE/DELETE policies at all**, making history tamper-resistant at the database layer (undo = new rows).
  - `change_items`: writable only while parent proposal `status = 'proposed'` (policy + trigger).
- Server code uses the **user-scoped client** (RLS enforced) for all normal operations. The service-role key is not used by the application in the slice; it exists only for migrations/ops.
- CI runs two-user RLS isolation tests (cross-read, cross-write, existence-inference via error shape) against local Supabase.

## 8. AI-service interfaces ⚑C6

```ts
interface DiscoveryEngine {
  runTurn(input: {
    projectId: string; userMessage: string;
    context: ProjectSnapshot;            // structured model summary + recent messages
  }, emit: (e: TurnEvent) => void): Promise<TurnResult>;
}

type TurnEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "activity"; label: string; kind: ActivityKind }   // app-emitted only
  | { type: "model_updates_applied"; fields: FieldUpdate[] }
  | { type: "proposal_created"; proposalId: string }
  | { type: "research_started"; researchId: string }
  | { type: "checkpoint_suggested"; summary: CheckpointSummary }
  | { type: "turn_failed"; error: SafeError }
  | { type: "done"; outcome: OutcomeSummary };
```

- Slice implementation `AnthropicDiscoveryEngine`: **one streaming Messages call with tools** `update_project_model`, `propose_connected_change`, `start_research`, `suggest_checkpoint`. Application code validates every tool input (Zod), authorises against the project, applies via services, and emits events. The model never writes anywhere.
- A deterministic `ScriptedDiscoveryEngine` implements the same interface for Playwright/e2e and UI development — the mock/real seam demanded by the addendum.
- Prompts are versioned files; the prompt version id is recorded on each turn's activity for reproducibility. Max tool steps per turn is capped (SECURITY_STANDARDS §17).
- Activity labels come from the orchestrator's actual operations, never from model prose (02 §T6).

## 9. Research-provider abstraction

```ts
interface ResearchProvider {
  start(task: ResearchTask, onEvent: (e: ResearchEvent) => void): ResearchHandle;
  steer(handle: ResearchHandle, direction: string):
    "applied_now" | "applies_next_step" | "requires_restart";
  stop(handle: ResearchHandle): void;
}
// ResearchEvent: step | finding | source | failed_source | done | failed
```

- Slice ships `MockResearchProvider`: a scripted, timed event sequence for the tenancy-deposit scenario; every finding/evidence row has `is_demo = true` and renders with a persistent "Demonstration data" label; mock sources are plainly fictional (VERTICAL_SLICE_SPEC §6 — fabricated sources must not look real).
- The contract is written so a real provider can implement SECURITY_STANDARDS §11.3 behind it (scheme allow-list, private-address blocking, redirect validation, size/type limits, timeouts, retrieval timestamps) with zero UI change. ⚑P3 confirm the contract against the intended real provider before Phase 3 ends.

## 10. Structured-output schemas

- One Zod schema per tool input, with: bounded string lengths, closed enums (`area`, `support`, `kind`), bounded array sizes, `.strict()` to reject unknown fields (mass-assignment defence), and cross-field checks (e.g. a proposal must list ≥1 affected area; `support` may never exceed what evidence kind allows).
- Invalid tool input → one retry with the validation errors appended; second failure → `turn_failed` preserving the user message, no partial writes, recoverable UI state (PROJECT_PLAN §12, SECURITY_STANDARDS §11.4).
- Free-form assistant prose is stored only as message content and rendered through the sanitised Markdown pipeline — it never becomes structured data.

## 11. Connected-change transaction model

- Proposal creation stores intent (targets + proposed `after` values + rationale). `before` values are **recomputed at approval time** inside the transaction to avoid staleness.
- Approval and undo are Postgres functions called via RPC so the whole operation is one transaction (supabase-js cannot compose client-side transactions — 02 §T3):
  - `apply_change_proposal(p_proposal_id, p_included_item_ids)` — verifies ownership (invoker rights, RLS-compatible), verifies `status='proposed'`, snapshots `before`, applies field updates, creates new `document_versions`, creates the `decisions` row, writes `audit_events`, sets status `approved`/`partially_approved`.
  - `undo_change_proposal(p_proposal_id)` — applies inverse values as **new** versions/field updates, marks `undone`, audits. History is never rewritten.
- Partial approval: excluded items recorded on `change_items.included`; the app computes and shows the consistency warning before submission; the warning text is stored in the audit detail.

## 12. Document-version model

- Append-only `document_versions`; `documents.current_version_id` pointer.
- `content` is structured JSON: ordered sections, each with text and a per-section state (`working_draft | supported | unvalidated | needs_review | approved | contradicted`) per DESIGN.md §14.
- Low-risk automatic edits create versions with `origin='ai_auto'` (visible in history, no interruption); structural edits only ever arrive through an approved change proposal (`origin='ai_approved'`).
- Milestones are named versions (`milestone_name`), created at checkpoints; "Restore previous version" creates a new version copying an old one.

## 13. Decision-history model

- `decisions` rows link proposal, evidence (via `decision_evidence`), affected areas (from change items), reasoning summary, alternatives, remaining uncertainty, proposer (`ai`), approver (user id), timestamp — exactly the VERTICAL_SLICE_SPEC Step 10 fields.
- No raw model reasoning is ever stored (SECURITY_STANDARDS §3.8); the reasoning summary is the user-facing rationale produced for the proposal.
- Timeline = `decisions` ordered by `created_at`, each expandable to evidence, change diff, and restore action.

## 14. Event/activity model

- `activity_events` is the single record of observable work: research steps, model updates, document updates, steering, errors — written by services as the work happens, streamed live over the turn's SSE connection, queryable afterwards for the full-history panel.
- `audit_events` is the separate consequential-action record (SECURITY_STANDARDS §14.2): approvals, undos, deletions, ownership-relevant actions — append-only with actor/action/target/approval state.
- UI: turn-level activity near the active turn; research/canvas activity at canvas top; persistent control opens history (DESIGN.md §9.1). `aria-live="polite"` announces phase changes and the completion summary only.

## 15. Error model

```ts
type SafeError = {
  code: ErrorCode;            // e.g. model_output_invalid, research_source_unavailable,
                              // proposal_conflict, rate_limited, session_expired
  userMessage: string;        // what happened + what remains usable (DESIGN.md §16)
  recoverable: boolean;
  actions?: UserAction[];     // e.g. retry_sources, compare_methodologies
  correlationId: string;
};
```

- Route handlers map internal failures to `SafeError`; stack traces and provider errors never reach the client; correlation ids link client reports to redacted server logs.
- Each `ErrorCode` has a designed UI treatment — no generic "Something went wrong" (UI_ACCEPTANCE §10). Failure states are part of each component's storybook of states, not afterthoughts.

## 16. Design-token integration

- `src/styles/design-tokens.css` remains the source of truth (moved from `styles/`).
- Tailwind v4 `@theme inline` maps the CSS variables to utility tokens (`bg-surface-primary`, `text-secondary`, `border-subtle`, `text-evidence`…), so components use Tailwind utilities that resolve to semantic variables — never raw values, never `dark:` overrides (theme switching is `data-theme`, handled entirely by the token file).
- shadcn primitives are added via CLI and re-themed: their CSS variables (`--background`, `--primary`, …) are defined **from** the semantic tokens in `globals.css`, and component variants are adjusted to the 8px radius and border/tonal-depth rules. shadcn supplies behaviour and accessibility; DESIGN.md supplies identity.
- Density/text-size/motion: existing `data-density`, `data-text-size`, reduced-motion media query in the token file wire directly to the settings controls.

## 17. Test strategy

- **Unit (Vitest)**: Zod schemas (accept/reject/mass-assignment), services, turn-event reducer, consistency-warning logic, apply/undo RPC behaviour against local Postgres.
- **Component (RTL + vitest-axe)**: every canvas object and turn block in all states (loading/empty/success/failure/reduced-motion); keyboard interaction tests for composer, action row, review sheet, divider.
- **RLS (CI)**: two-user isolation suite against local Supabase — cross-project read/write/update on every table, ownership reassignment attempts, existence inference via error shape.
- **E2E (Playwright)**: full vertical journey with `ScriptedDiscoveryEngine` + `MockResearchProvider` (no API key in CI); axe scans on each surface; theme-switch, reduced-motion, and keyboard-only journey runs; screenshot assertions on a small set of stable shell states (⚑U3 full visual-regression tooling deferred).
- **Security tests** per 07 §12.
- Live-model smoke test runs locally/nightly only, never blocking CI.

## 18. Deployment approach

- Vercel (production + preview) + Supabase (separate dev and prod projects; previews point at dev). Secrets only in Vercel/Supabase secret managers; separate keys per environment; nothing `NEXT_PUBLIC_` except the Supabase URL + publishable key (SECURITY_STANDARDS §9).
- CI (GitHub Actions): typecheck → lint → unit/component → RLS suite → e2e+axe; branch protection on main; secret scanning enabled; dependency alerts on; lockfile committed; third-party actions pinned.
- Migrations applied via Supabase CLI from `supabase/migrations/` — reviewed, versioned, RLS included in the same migration as each table.
- Security headers + CSP configured in `next.config` / middleware from Phase 1 (07 §8).

## 19. Vector database

**Not required, and not introduced.** The slice's retrieval needs are structured lookups by project id (fields, evidence, documents, decisions) — pure relational queries. Conversation context uses recent messages plus a compact structured-model summary, not semantic search. Ordinary Postgres is sufficient because nothing in the slice searches unstructured text by similarity. Re-evaluate only if a future feature must semantically search large evidence corpora; even then, `pgvector` inside the existing Postgres would be the first candidate, not a separate database (CLAUDE_REVIEW_PROMPT §4 constraint honoured).
