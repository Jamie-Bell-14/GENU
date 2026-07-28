# Security Review of the Approved Architecture

> Status: **approved** (Phase 0 review, 2026-07). Reviews docs/ARCHITECTURE.md against SECURITY_STANDARDS.md, section by section per CLAUDE_REVIEW_PROMPT §8. Where the architecture already embeds the control, this records where; where a control is deferred, the compensating position is stated per SECURITY_STANDARDS §2.

## 1. Authentication and session boundaries

- Supabase Auth only (email + password, verified email) via `@supabase/ssr`; middleware refreshes sessions; no custom credential storage anywhere (§5).
- Every route handler and Server Action begins with session resolution from cookies; identity is never accepted from request bodies. Session tokens never appear in URLs or logs.
- Auth flows use Supabase's built-in rate limits, verified and configured in T4; response wording avoids account enumeration beyond provider defaults.
- Deferred with rationale: MFA and re-authentication-before-sensitive-action — the slice has no email-change/export/delete/ownership-transfer surfaces yet; these controls are required before those features exist, recorded as a §24-style exception with review at Phase 3 exit.

## 2. Authorisation and ownership checks

- Two independent layers on every protected operation (defence in depth, §3.3): explicit ownership check in the service layer (actor → project → resource, nested resources authorised through their parent project) **and** RLS underneath.
- No user-supplied `user_id`/owner fields are trusted anywhere; all identity derives from the verified session (§6).
- IDOR: all resource ids are validated as belonging to the actor's project; error responses are uniform (`not_found` shape identical for "doesn't exist" and "not yours") to prevent existence inference — tested in the RLS suite.
- New projects default private; there is no sharing surface, so no sharing rules are needed yet (§6 "define explicit rules before adding sharing").

## 3. Supabase RLS strategy

- RLS enabled in the same migration that creates each table — no window where a table exists unprotected (§7.1).
- Explicit per-command policies; `private.is_project_owner()` security-definer helper in a non-exposed schema; `project_id` indexed on every child table for policy performance.
- Tamper resistance in the schema itself: `document_versions`, `decisions`, `audit_events`, `activity_events` have **no UPDATE/DELETE policies** — history cannot be rewritten even by the owner (§14.2 audit integrity); `projects.owner_id` immutable via WITH CHECK + trigger (§7.1 ownership reassignment).
- The application never uses the service-role key; the slice's only elevated access is the migration pipeline (§7.2). A CI grep-gate asserts the service key string pattern appears nowhere in `src/`.
- Two-user RLS isolation tests run in CI for every table (§7.1 "a table is not complete until its RLS behaviour is tested"; §6's full cross-user list is the test matrix).

## 4. Secret and environment-variable handling

- Server-side only: `ANTHROPIC_API_KEY`, Supabase secret key (unused by app code), any webhook secrets. Browser receives only the Supabase URL + publishable key (§7.2, §9).
- No `NEXT_PUBLIC_` secrets — enforced by review checklist plus a CI check that fails on `NEXT_PUBLIC_.*(KEY|SECRET|TOKEN)` patterns beyond the allow-listed publishable key.
- Separate credentials for dev and production Supabase/Vercel; production secrets only in the deployment provider's secret manager; `.env*` gitignored from T1; GitHub secret scanning enabled; exposure response = rotate first, per §20.

## 5. Prompt-injection controls

- Slice injection surface is deliberately minimal: the only untrusted content reaching the model is the user's own messages and previously stored project content. Mock research means **no retrieved web content enters context at all** until real research ships with its controls.
- System instructions are separated from user/content blocks; stored project content re-entering context (field values, evidence summaries) is wrapped in labelled data-delimiters with the standing instruction that it is data, not instructions (§11.1) — this matters even self-authored, since a user can paste hostile text that later re-enters context.
- Tool requests are validated and authorised by application code independent of any model prose; retrieved-or-stored content can never grant permissions because permissions are checked against the session, never against context (§11.1, §11.2).
- A prompt-injection test suite (T9) covers: instruction-override attempts in user messages, attempts to have prose treated as tool output, attempts to write structural fields through the model-update tool (blocked by closed enums), and attempts to trigger apply-without-approval (blocked by the DB state machine).

## 6. Web-research and URL-fetching risks

- Slice: zero outbound retrieval — SSRF, redirect, and content-type risks are absent by construction, and demonstration data is schema-flagged (`is_demo NOT NULL`) so it cannot silently pose as research (§11.3's honesty clause; VERTICAL_SLICE_SPEC §6).
- The `ResearchProvider` contract pre-commits the real implementation to §11.3: https-only scheme allow-list, DNS/IP resolution blocking private/link-local/metadata ranges, redirect re-validation per hop, response size and content-type limits, timeouts, no script execution, retrieval timestamps + final URLs preserved, retrieved text treated as untrusted model input. Real research is a High-risk change requiring its own security review before merge (§4).

## 7. AI tool permissions

- The model proposes; application code disposes (§11.2). Tools have strict Zod schemas; tool handlers run under the acting user's authorisation only (user-scoped DB client — least privilege by construction); tool access is scoped to the active project id from the route, never from model output.
- Destructive/structural effects (connected changes) require explicit user approval enforced by the `change_proposals` state machine in Postgres — reformulating the request cannot bypass it because no tool writes structural fields directly (§11.2 "cannot bypass approval by reformulating").
- Caps: max tool steps per turn, max output tokens per call, one schema-retry; all consequential tool calls audited with correlation ids.

## 8. Validation and output rendering

- Zod at every boundary: route handler inputs (length-bounded, `.strict()`), tool inputs, research events, stored jsonb shapes on read where they cross into rendering. Unknown fields rejected (mass-assignment, §18.1).
- Request-size limits on all POST bodies; message length limit with honest UI feedback.
- Rendering: assistant Markdown through a sanitising pipeline (allow-list of elements, no raw HTML pass-through, no `dangerouslySetInnerHTML` of model or user content); URLs in evidence/source fields validated (https) before becoming anchors, `rel="noopener noreferrer"`; no embedded external content in the slice.
- CSP from Phase 1: default-src 'self'; no third-party script origins exist in the slice; frame-ancestors 'none'; plus standard headers (X-Content-Type-Options, Referrer-Policy strict-origin-when-cross-origin, HSTS in production) (§13).

## 9. Logging and redaction

- Structured server logs with correlation ids per turn; logged: event kinds, durations, token counts, error codes, auth/authz failures. Never logged: message bodies by default, prompts, tokens/keys, session cookies, full headers, hidden model reasoning (which is also never stored — §3.8, §14.1).
- `activity_events` (user-facing observable work) and `audit_events` (consequential actions with actor/action/target/approval state) are separate from operational logs, per §14.2; audit append-only at RLS level.
- No analytics/monitoring third parties in the slice, so no private-content leakage path exists yet; adding Sentry later requires scrubbing config review (§13, §15) as its own task.

## 10. Rate limiting and cost-abuse controls

- Per-user limits on: conversation turns, research starts, proposal approvals (idempotent anyway), auth flows (provider-side). Slice mechanism: Postgres-based sliding-window counters checked in route handlers — no new infrastructure; swappable for Redis later. 429s return retry timing (§17).
- Cost caps: per-turn max tokens, per-turn tool-step cap, concurrent-turn lock per project (also prevents parallel-request abuse), provider spend alerts + monthly budget on the Anthropic account (⚑ decision P4 sets numbers).
- Runaway-loop protection: schema-retry limited to one; research steps bounded by the scripted provider now and by step/time budgets in the contract for real providers.

## 11. Threat modelling

Slice threat model (assets: private project content, API keys, audit integrity; actors: owner, other authenticated users, unauthenticated internet, the model itself as a confused deputy):

| Threat (from §19) | Slice posture |
|---|---|
| Cross-project data access | RLS + service-layer checks + CI isolation tests |
| Prompt injection from web research | Absent (no retrieval); controls pre-committed for later |
| Malicious uploads | Absent (uploads disabled until §12 controls exist) |
| AI-induced unauthorised actions | Tool validation + DB approval state machine + user-scoped client |
| SSRF | Absent (no outbound fetch) |
| XSS via generated content | Sanitised Markdown, CSP, no raw HTML |
| Idea leakage | RLS, private-by-default, no analytics, minimal provider context (§11.5) |
| Service-key exposure | Key unused by app; grep-gate; rotation runbook |
| Audit tampering | Append-only tables without UPDATE/DELETE policies |
| Cost abuse | §10 above |
| False provenance | `is_demo` flag + app-emitted activity only + provenance UI |
| Partial connected changes | Single-transaction RPCs with rollback tests |

Residual risks to accept explicitly at slice release: no MFA; single-region Supabase backups on provider defaults; provider retention settings must be verified before real user data (§11.5, §15) — owner sign-off required (§23).

## 12. Security testing

- Automated (§18.1 mapped): RLS isolation suite; authz on every route handler (wrong-user, no-session); schema validation + mass-assignment rejection; connected-change approval flow incl. bypass attempts; transaction rollback under forced mid-apply failure; prompt-injection suite; malicious tool-output suite (invalid, oversized, field-smuggling); rate-limit behaviour; uniform not-found responses. Unsafe-URL and deletion/export permission tests activate with those features.
- Manual before production (§18.2): ASVS L2 applicability pass, data-flow diagram, this threat model refreshed, RLS policy read-through, secret handling walkthrough, provider data-flow + retention verification, incident-response ownership (§20) documented.
- Regressions: any fixed vulnerability gets a test + root-cause note (§18.3).

## 13. Production security gates (§23 mapping)

Before any production release of the slice: secrets outside Git ✅ by construction · RLS enabled+tested ✅ CI · HTTPS ✅ Vercel+HSTS · headers/CSP reviewed (T15) · rate/cost limits active (T6/T9) · monitoring: minimal — uptime + Supabase/Anthropic budget alerts; full monitoring stack is a recorded gap · deletion/export: **not yet implemented — the gate cannot pass for public launch**; acceptable only for private/owner-only use until project deletion + export ship (first post-slice security task) · backups understood (Supabase defaults documented) · dependency criticals resolved · threat model reviewed (this document) · injection tests pass (T9/T15) · incident owner defined (⚑ needs a name) · residual risks §11 signed off.

**Net position:** the architecture satisfies SECURITY_STANDARDS for the slice's scope by construction rather than by later audit; the enumerated deferrals (MFA, real research controls, uploads, deletion/export, full monitoring) are features that don't exist yet, each pre-bound to its controls before it may ship.
