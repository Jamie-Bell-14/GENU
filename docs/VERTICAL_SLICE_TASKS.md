# Vertical-Slice Task Plan

> Status: **approved** (Phase 0 review, 2026-07). Tasks are sequential; each depends on the ones before it unless noted. Design system and workspace primitives (T1–T7) precede the complete scenario (T8–T15), as CLAUDE_REVIEW_PROMPT §5 requires. Every task carries the SECURITY_STANDARDS §21 checklist; the **Security** line below records the material answers per task. "UI acceptance" always means the relevant sections of docs/UI_ACCEPTANCE_CRITERIA.md plus dark+light review, keyboard, reduced motion, and loading/empty/success/failure states — repeated per task only where something specific needs calling out.

Approved decisions in force (PROJECT_PLAN.md §17): qualitative confidence, single-call engine, zoned canvas without dragging, email+password auth, mock research only. References like "02 §L" and "06 §6" point to the Phase 0 review archive in docs/review/.

## Deferred issue gate protocol

`CLAUDE.md` requires this file to be read before implementation. The issue gates recorded here are therefore mandatory task scope and must be checked without waiting for the user to mention them.

Before planning, implementing or reviewing any task `Tn`:

1. Read that task's **Issue gates** line and open every linked issue.
2. Add each linked issue to the implementation plan and final acceptance checklist.
3. An **entry gate** must be closed before implementation of that task begins.
4. An **exit gate** must be closed before that task is marked **Implemented**, approved for merge or merged.
5. A dated independent-backlog issue remains non-blocking only until its stated date or release gate. Once triggered, treat it as P0 until closed.
6. A gate may be deferred again only by explicitly updating both the issue's delivery contract and this task plan with a new named task or exact calendar deadline. A PR comment alone does not reassign ownership.
7. At task completion, report every gate as **closed**, **still blocking**, or **explicitly reclassified**. Silence is not completion.

---

### T1 — Project scaffold and tooling
- **Objective:** Next.js (App Router, `src/`, strict TypeScript) + Tailwind v4 + ESLint/Prettier + Vitest + RTL + Playwright + GitHub Actions CI skeleton (typecheck/lint/test), lockfile committed, branch protection notes.
- **Dependencies:** approval of this review.
- **Files:** `package.json`, `next.config.ts`, `tsconfig.json`, `eslint`/`prettier` config, `src/app/layout.tsx`, `src/app/page.tsx` (placeholder), `.github/workflows/ci.yml`.
- **Functional:** `dev`, `build`, `test`, `lint`, `typecheck` all pass; CI green on the branch.
- **UI/UX acceptance:** n/a (no UI yet); placeholder page must not ship generic scaffold branding.
- **Edge cases:** Node version pinned; CI cache correctness.
- **Tests:** one smoke unit test + one smoke Playwright test to prove harnesses run in CI.
- **Out of scope:** any product UI, Supabase, tokens.
- **Security:** no data touched; dependency minimalism (SECURITY_STANDARDS §16); secret scanning + dependency alerts enabled on the repo; no secrets in code.
- **Done when:** CI passes all harnesses; README updated with commands.

### T2 — Design tokens and appearance infrastructure
- **Objective:** move `styles/design-tokens.css` → `src/styles/`, map tokens into Tailwind v4 `@theme`, implement `data-theme` (dark/light/system), `data-density`, `data-text-size`, reduced-motion wiring, localStorage persistence, no-flash theme init.
- **Dependencies:** T1.
- **Files:** `src/styles/design-tokens.css`, `src/styles/globals.css`, `src/app/layout.tsx`, `src/lib/appearance/*`, tests.
- **Functional:** switching theme/density/text size updates the document attributes and persists; system theme tracks OS; reduced motion zeroes motion tokens.
- **UI/UX acceptance:** both themes render token demo correctly; no hardcoded colours anywhere (lint check or grep gate).
- **Edge cases:** SSR/first-paint flash; invalid stored values; OS theme change while open.
- **Tests:** unit for persistence/attribute logic; component test for provider; theme-switch Playwright check.
- **Out of scope:** settings UI (T5), components.
- **Security:** localStorage holds only preference strings — no sensitive data client-side (§13).
- **Done when:** tokens are consumable as Tailwind utilities and all four appearance controls work programmatically.

### T3 — Base primitives (shadcn, re-themed)
- **Objective:** add the needed shadcn primitives (button, input, textarea, dialog, sheet, popover, dropdown-menu, tooltip, toggle-group, separator, skeleton, badge, command, resizable, scroll-area, field/input-group) and re-theme them: shadcn CSS variables defined from semantic tokens, 8px radius, border/tonal depth per DESIGN.md §7, shadows only on floating elements.
- **Dependencies:** T2.
- **Files:** `src/components/ui/*`, `globals.css`, `components.json`.
- **Functional:** a primitives review page (dev-only route) shows every primitive in both themes and all states.
- **UI/UX acceptance:** no default-shadcn look survives (colours, radius, focus ring use tokens); focus visible everywhere.
- **Edge cases:** disabled/invalid states in both themes; forced-colours mode sanity check.
- **Tests:** axe on the review page; component tests for focus visibility and variant classes.
- **Out of scope:** product components, chat primitives composition.
- **Security:** none material (no data).
- **Done when:** every primitive consumes tokens only and passes axe.

### T4 — Supabase foundation: auth + projects + RLS
- **Objective:** Supabase local + project setup, `@supabase/ssr` clients + middleware, email+password sign-up/sign-in/sign-out with verified email, first migration (`projects` table + RLS + owner immutability), project list/create UI (plain), RLS test harness.
- **Dependencies:** T3.
- **Files:** `supabase/migrations/0001_projects.sql`, `src/lib/supabase/*`, `src/app/(auth)/*`, `src/app/(workspace)/projects/*`, `supabase/tests/*`, middleware.
- **Functional:** register → verify → sign in → create project → list projects → open project route; signed-out users are redirected.
- **UI/UX acceptance:** auth screens follow DESIGN.md (calm, on-brand, no template look); error states are specific (bad credentials vs unverified vs rate-limited) without enabling account enumeration beyond provider defaults.
- **Edge cases:** expired session mid-action; duplicate sign-up; password policy; middleware refresh.
- **Tests:** two-user RLS isolation suite (read/write/update/delete + owner reassignment) in CI; e2e auth+create-project flow.
- **Out of scope:** OAuth, MFA, account deletion/export UI, password reset polish (basic reset only).
- **Security:** the trust boundary task — Supabase Auth flows only (§5); cookies via `@supabase/ssr` defaults; rate limits on auth endpoints (Supabase built-ins verified + configured); publishable key only in browser; service key absent from app code; audit sign-in failures via Supabase logs.
- **Done when:** RLS suite green in CI; cross-user access provably denied.

### T5 — Workspace shell
- **Objective:** the three-region shell: planning navigation (Opportunity/Customer/Product/Commercial/Build/History, collapsible), conversation pane, canvas pane, draggable divider with keyboard resizing, focus modes (conversation/canvas/balanced), layout persistence, settings menu (theme/density/motion/text size), skip links and landmarks.
- **Dependencies:** T4 (lives at `/projects/[id]`).
- **Files:** `src/components/workspace/*`, workspace page, `src/lib/appearance` extension.
- **Functional:** all DESIGN.md §3.1 layout operations work and persist; nav shows the stable structure with empty-state content (no dead links — sections that have no content yet say so honestly).
- **UI/UX acceptance:** structure matches DESIGN.md §3; does not read as chatbot or dashboard; divider has `role="separator"` + arrow keys; shell keyboard-navigable end to end.
- **Edge cases:** minimum pane widths; narrow desktop windows; restored layout for a deleted preference.
- **Tests:** keyboard navigation tests; layout persistence unit tests; axe; screenshot assertions of shell states (balanced/focused/collapsed × themes).
- **Out of scope:** real conversation/canvas content (arrive T6/T7); mobile layouts (deferred).
- **Security:** layout prefs local only; no project content in logs.
- **Done when:** shell passes the UI acceptance checklist with placeholder panes.

### T6 — Conversation primitives
- **Objective:** editorial conversation stream (turn blocks, not bubbles), composer with adaptive placeholder + send/stop, contextual action row (≤3, stable position), rich block frames for challenge/assumption/proposal/checkpoint/outcome, message persistence (user + assistant rows), loading/empty/failed-turn states.
- **Dependencies:** T5; `messages` migration.
- **Files:** `src/components/conversation/*`, `supabase/migrations/0002_messages.sql`, turn route skeleton, `src/lib/services/messages.ts`.
- **Functional:** user can send a message; a stubbed engine echoes a structured response; stream renders deltas; failed turn preserves the user's text in the composer.
- **UI/UX acceptance:** editorial stream per DESIGN.md §8 — attribution clear without opposing bubbles; ordinary responses concise; composer never moves.
- **Edge cases:** rapid submits (client + server guard), long messages (length limit with honest message), disconnect mid-stream (resume shows persisted result).
- **Tests:** reducer unit tests for all TurnEvents; component states; keyboard: send with Enter/mod+Enter, stop, action-row focus order; RLS tests for `messages`.
- **Out of scope:** real model calls (T9), research (T10), canvas linkage.
- **Security:** input length limits + Zod on the turn endpoint; per-user turn rate limit installed now (§17); messages RLS-scoped; no message bodies in server logs.
- **Done when:** a scripted conversation round-trips with persistence and all states demonstrable.

### T7 — Canvas primitives and object grammar
- **Objective:** zoned living canvas (current subject, related concepts, evidence, assumptions, project outline) + the six object components sharing `CanvasObjectFrame` (status rail, text labels, icons, 8px radius); pin/collapse/hide/re-centre/undo-view with keyboard equivalents; canvas empty/loading/failure states; `project_fields` + `assumptions` migrations and services.
- **Dependencies:** T5; parallelisable with T6 after T5.
- **Files:** `src/components/canvas/*`, `supabase/migrations/0003_model.sql`, `src/lib/services/project-model-store.ts`.
- **Functional:** canvas renders the sparse Step 2 model from DB rows; origin labels (user-stated vs AI-inferred) always visible; view operations work and undo.
- **UI/UX acceptance:** sparse early canvas that communicates uncertainty (DESIGN.md §4); not a flowchart; object states never colour-only; canvas DOM is ordered regions (screen-reader coherent).
- **Edge cases:** many objects in a zone (overflow strategy), long titles, all-hidden state, re-centre on removed object.
- **Tests:** component tests per object type × state; keyboard operation tests; RLS tests for new tables; axe.
- **Out of scope:** free dragging (deferred per U2), research view (T10), comparison view (T11 minimal).
- **Security:** model writes only via service layer with Zod; RLS on new tables; audit not yet needed (no consequential actions).
- **Done when:** Step 2 acceptance criteria (sparse, labelled, editable meaning) demonstrable with stub data.

### T8 — Activity system
- **Objective:** SSE turn/research event transport; activity display at turn level and canvas top; persistent activity-history panel; stop/steer controls with the applies-now/next-step/restart contract; `activity_events` + `audit_events` migrations; polite screen-reader announcements.
- **Dependencies:** T6, T7.
- **Files:** `src/components/activity/*`, `src/lib/services/activity.ts`, `audit.ts`, migration `0004_events.sql`, turn route SSE upgrade.
- **Functional:** activity lines appear as work happens, fade when done, full history retrievable; stop cancels; steer records and reports its application mode.
- **UI/UX acceptance:** activity is specific and ignorable (DESIGN.md §9); no percentages; final result remains after activity fades.
- **Edge cases:** reconnect mid-activity; overlapping activities; stop racing completion.
- **Tests:** event-stream unit tests; reconnection test; aria-live behaviour test; RLS on event tables (SELECT/INSERT only).
- **Out of scope:** real research (T10).
- **Security:** activity labels generated server-side from real operations only (02 §T6); audit table append-only; correlation ids introduced here.
- **Done when:** a scripted multi-step activity is observable, steerable, stoppable, and honestly recorded.

### T9 — Discovery engine (real model)
- **Objective:** `AnthropicDiscoveryEngine` — one streaming tool-use call per turn; tools `update_project_model`, `record_assumption`, `propose_connected_change` (stub apply), `suggest_checkpoint`, `recommend_canvas_scene`; Zod validation with one retry; context assembly (snapshot + recent messages); prompt versioning; token/step caps; worker lease renewal for long-running turns; `ScriptedDiscoveryEngine` given the same interface for CI.
  - The tool list above is wider than this line originally carried. `record_assumption`, `recommend_canvas_scene` and `suggest_actions` are all required by this task's own completion criterion — Step 3 acceptance is "the assumption appears on the canvas" with "≤3 contextual actions", and the scene hook exists from T8 with no tool able to reach it. The first two are in the canonical operation set (docs/AI_SYSTEM.md §5). They are additions to the task line, not to approved scope.
  - **Turn bounds are per turn, not per request.** `max_tokens` is a per-request ceiling, so the turn tracks a cumulative output allowance and offers each request only the remainder; the tool cap counts tool-use *blocks* rather than provider rounds, because one response may contain many. A `max_tokens` stop reason is a bounded failure, never a completed answer.
  - **Project-truth writes are staged and committed once, on success.** A turn that fails at any point — schema, provider, timeout, cap, refusal — writes nothing, which is what makes AI_SYSTEM §5's "no partial write" true for every path rather than only the schema one. The engine returns its staged operations rather than committing them: the answer, project truth and the turn's terminal state have to move together, and only the host can order those (AI_SYSTEM §4.1).
  - **"One unit" means one transaction, and a turn has exactly two.** `start_turn` writes the user message and the run together after reconciling an expired lease; `complete_turn` writes the answer, applies the accepted field and assumption writes, and records the terminal state. Ordering three separate durable writes was not enough: catch-up treats a stored answer as settlement, so an answer that outlived its project writes would read as a completed turn whose changes had vanished. A loop in application code cannot promise all-or-none, and a check followed by a write cannot promise the checked state still holds.
  - **Both elevated functions authorise their own caller.** They are `security definer` and reachable only by the trusted writer, so RLS cannot decide who is allowed in — each checks the acting user owns the project, inside the transaction, rather than inheriting a check the route may or may not have made.
  - **A refusal is not a failure.** A field the person stated themselves is expected to be refused; discarding an answer the user is reading because one proposed write was not permitted would be the worse mistake. Refusals are reported per operation and audited; only genuine faults abort the commit.
  - **The first turn's canvas comes from the application, not the model.** On a new project there are no ids to name, so a recommended scene can only be a guess and is rejected. The visible sparse model is the application's own derived, validated default view, adopted once the committed rows exist.
  - **Provenance is derived, never accepted.** The model may not set `user_stated` or `researched`; it may offer an excerpt it attributes to the person, which the host verifies against the message it actually received — and the *stored words must be that excerpt*, since a genuine phrase attached to an invented value is not evidence for the value. An unverified excerpt means the field is recorded as inference. A user-stated row carries the verified words and the turn they came from, so the claim can be audited later. An AI update may not replace the value of a field the person stated — that is a proposal, not a turn.
  - **Turn timeout exceeds the lease deliberately.** `TURN_TIMEOUT_MS` (20 min) is longer than `LEASE_TTL_SECONDS` (15 min) so issue #11's invariant — a healthy turn stays `running` past one lease period because heartbeats say so — is reachable rather than pre-empted by the engine giving up first. Lease renewal is monotonic in SQL, so no renewal can shorten a lease.
  - **One running turn per project**, serialised on the project row inside `start_turn` and backed by a partial unique index rather than by a React guard. A refused start writes nothing at all, so the 409 keeps the user's text in the composer instead of leaving the same sentence in the transcript as well.
- **Dependencies:** T6, T7, T8.
- **Files:** `src/lib/ai/*`, `src/lib/services/model-operations.ts`, turn route wiring, engine config, lease-renewal migration, `supabase/migrations/20260730090000_turn_start_and_operations.sql`.
- **Functional:** Steps 2–3 of the journey work live: reflection separating fact from inference, sparse canvas updates, one focused question, specific assumption challenge with ≤3 contextual actions.
- **UI/UX acceptance:** response depth rules (DESIGN.md §8.2); challenge is specific; no generic praise.
- **Edge cases:** schema-invalid tool input (retry then safe fail), model timeout, oversized responses, tool-step cap hit, concurrent turns blocked, safety refusal (reported as its own state, not as an outage), lease renewal failing or arriving after the run has ended.
- **Tests:** engine unit tests with recorded/stubbed SDK responses (valid, invalid, malicious-fields, over-limit); prompt-injection suite (user message attempts to override system rules / mint permissions / write via prose); e2e stays on scripted engine.
- **Out of scope:** research tool (T10), real change application (T12).
- **Security:** ANTHROPIC_API_KEY server-only; minimum-necessary context sent to provider (§11.5); untrusted user content delimited and labelled in prompts; tool inputs validated + authorised independently of model text; per-turn token caps; usage logged without message bodies.
- **Done when:** live Steps 2–3 pass acceptance and the malicious-output test suite is green.

### T10 — Research flow (mock provider) + research view + evidence intake
- **Issue gates:** **#13 is a T10 exit gate.** It must be included in the T10 plan and closed before T10 is marked **Implemented**, approved for merge or merged.
- **Objective:** `MockResearchProvider` scripted tenancy-deposit research; "Research this" action; research view (key finding, focused visualisation with data-table alternative, why-it-matters, source markers, explore/inspect actions); provenance detail (source, date, method, limitations, retrieval time, AI interpretation separated); persistent "Demonstration data" labelling; "Add as evidence" → `evidence` rows linked to canvas concepts with consequence summary honest about what the evidence does *not* support.
- **Dependencies:** T8, T9; `evidence` migration `0005_evidence.sql`.
- **Files:** `src/lib/research/*`, `src/components/research/*`, evidence service, canvas research mode.
- **Functional:** VERTICAL_SLICE_SPEC Steps 4–6 end to end, including steer ("Focus on England…") with explicit application mode, unavailable-source and conflicting-evidence states.
- **UI/UX acceptance:** evidence-led progressive view (DESIGN.md §11); estimates and conflicts styled differently; chart has text summary; demo labelling impossible to miss but not hysterical.
- **Edge cases:** stop mid-research; add-as-evidence twice (idempotent); evidence linked to a hidden object; all sources unavailable.
- **Tests:** provider event-sequence tests; component states incl. conflicting/unavailable; e2e Steps 4–6; RLS on evidence tables; test that `is_demo` data can never render without its label.
- **Out of scope:** real web retrieval (deferred with §11.3 controls), deep exploration filters beyond one level.
- **Security:** no external fetches at all in the slice (SSRF surface deliberately zero); `is_demo` is `NOT NULL` at the schema level; evidence content treated as untrusted when later fed to the model (labelled data-not-instructions).
- **Done when:** Steps 4–6 acceptance criteria pass with honest provenance **and #13 is closed**.

### T11 — Connected-change proposals and transactional apply/undo
- **Issue gates:** **#14 is a T11 entry gate.** After T10 completes, #14 must be closed before T11 implementation begins or a T11 implementation PR is opened.
- **Objective:** proposal creation from the engine tool; `ChangeProposalSheet` (per-item before/after, include/exclude, partial-approval inconsistency warning); `apply_change_proposal` and `undo_change_proposal` Postgres RPCs (single transaction: fields + document versions + decision + audit); canvas highlight of affected branches; outcome summary with Review changes / Undo / Open document actions.
- **Dependencies:** T9, T10; documents tables land here (`0006_changes_documents.sql`) since apply writes versions.
- **Files:** RPC migrations, `src/lib/services/change-proposals.ts`, `src/components/changes/*`, engine tool wiring.
- **Functional:** VERTICAL_SLICE_SPEC Steps 7–8: proposal spanning target customer / problem / value proposition / MVP scope; nothing auto-applies; single-action undo restores prior state as new history.
- **UI/UX acceptance:** review sheet is a focused overlay, single-column per-item review (06 §6); approval affordance unmistakable; warning on partial approval specific about which inconsistency.
- **Edge cases:** approve twice (idempotent via status check), stale proposal after model changed underneath (before-recompute + conflict error), exclude-all (becomes rejection), undo after further edits (conflict surfaced honestly, not silent overwrite).
- **Tests:** RPC transaction tests incl. forced mid-failure rollback (no partial application — §7.4); RLS: only owner can apply; e2e Steps 7–8 incl. partial approval and undo; audit rows asserted.
- **Out of scope:** cross-proposal conflict resolution UI beyond the conflict error state.
- **Security:** the highest-risk task — approval enforced by DB state machine, not prompt; RPCs invoker-rights + ownership-verified; append-only history; every apply/undo audited with actor + approval state; mass-assignment impossible (item targets validated against closed enum of areas).
- **Done when:** transaction tests prove all-or-nothing; journey Steps 7–8 pass; #14 was closed before implementation began.

### T12 — Living documents
- **Objective:** document view (four documents), per-section states, "what changed / by what / when" header, version history list, named milestone creation, restore-as-new-version; low-risk auto-edit path (`ai_auto`) visible in history.
- **Dependencies:** T11.
- **Files:** `src/components/documents/*`, document service completion.
- **Functional:** VERTICAL_SLICE_SPEC Step 9: approved change visibly updates MVP scope-style content with the change summary; automatic vs approved origin always displayed.
- **UI/UX acceptance:** editorial document treatment (not a card grid); section states labelled + coloured; history readable.
- **Edge cases:** viewing an old version (clearly not-current), restore of milestone, document with no versions yet.
- **Tests:** version pointer unit tests; component states; e2e Step 9; RLS (versions SELECT/INSERT only).
- **Out of scope:** free-form document editing by the user (post-slice), export.
- **Security:** version immutability at RLS level; origin field cannot be forged by client (server-set).
- **Done when:** Step 9 acceptance passes; history shows both origins truthfully.

### T13 — Decision history
- **Objective:** decision timeline in the History nav area + decision detail (all Step 10 fields), actions: open evidence, view changes, reconsider (creates a new proposal), restore previous version (via T12).
- **Dependencies:** T11, T12.
- **Files:** `src/components/decisions/*`, decisions service.
- **Functional:** the Step 8 approval produced a decision entry with attribution ("Proposed by AI · Approved by you"), evidence links, alternatives, remaining uncertainty.
- **UI/UX acceptance:** timeline is the strategic story (DESIGN.md §15), not a log dump; attribution explicit.
- **Edge cases:** decision whose evidence was later contradicted (state shown); reconsider flow cancelled midway.
- **Tests:** component states; e2e Step 10; append-only RLS asserted.
- **Out of scope:** milestone version browser beyond list; collaboration attribution.
- **Security:** append-only; no hidden reasoning stored (asserted by test that stored fields ⊆ user-facing schema).
- **Done when:** Step 10 acceptance passes.

### T14 — Milestone checkpoint
- **Objective:** engine `suggest_checkpoint` wiring; checkpoint block (credible / uncertain / evidence / decisions / risks / recommended next direction); Review now / Later / Continue exploring; postponing never blocks conversation; checkpoint review creates a named milestone version set.
- **Dependencies:** T12, T13.
- **Files:** `src/components/conversation/checkpoint-*`, engine tool schema, milestone wiring.
- **Functional:** VERTICAL_SLICE_SPEC Step 11 acceptance: suggested not forced; stage not marked permanently complete.
- **UI/UX acceptance:** rounded display typography moment (DESIGN.md §6.1) used here deliberately; summary preview is a preview, not a wall.
- **Edge cases:** checkpoint suggested twice; checkpoint with zero decisions; dismiss then request manually.
- **Tests:** component states; e2e Step 11.
- **Out of scope:** stage-progression engine beyond this checkpoint.
- **Security:** milestone creation audited.
- **Done when:** Step 11 passes.

### T15 — Journey hardening and acceptance
- **Objective:** full-journey e2e (Steps 1–11, scripted engine) incl. keyboard-only run, reduced-motion run, both themes; axe across all surfaces; error-state walkthrough (every SafeError code demonstrable); rate-limit behaviour verification; full docs/UI_ACCEPTANCE_CRITERIA.md pass recorded; SECURITY_STANDARDS §22 PR checklist + §18.1 automated-test inventory review; performance pass (turn latency budget, canvas render profiling).
- **Dependencies:** T1–T14.
- **Files:** tests, fixes, docs updates (README run instructions, architecture notes sync).
- **Functional:** VERTICAL_SLICE_SPEC §8 completion criteria all demonstrably true.
- **UI/UX acceptance:** the full checklist, formally recorded in the PR.
- **Edge cases:** this task exists to hunt them; triage list maintained in the PR.
- **Tests:** the suites above; flake stabilisation.
- **Out of scope:** new features of any kind.
- **Security:** §18.1 checklist review; residual risks documented per §23.
- **Done when:** you can run the journey end to end and every checklist passes or has a recorded, owned exception (§24).

## Dated independent backlog gates

These issues are not owned by a specific task, but they cannot remain indefinitely unowned:

- **#15 — due 2026-09-30 or before external beta, whichever comes first.** Before that trigger it is P2. Once triggered it becomes P0: no release/hardening PR may be marked **Verified** or merged until #15 is closed or explicitly reclassified with a new exact deadline in both places.

---

**Not in any task (deferred, no dead controls):** mobile layouts, real web research, file uploads (SECURITY_STANDARDS §12 controls not yet built — uploads stay disabled), export, billing, collaboration, founder personalities, open canvas editing, remaining entry paths, analytics.
