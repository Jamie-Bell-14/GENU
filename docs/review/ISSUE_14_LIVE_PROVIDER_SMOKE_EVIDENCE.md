# Issue #14 — T11 Entry Gate: Live-Provider Smoke Test Evidence

> Status: **NOT YET MARKED PASSING.** Two earlier attempts failed (see
> "Attempt log" below); the cause of Attempt 2 was fixed on this branch. A
> third run ("Test 5") then behaviourally passed all three turns — see
> "Successful run — Test 5" below — but this document is not moved to
> PASSING until two outstanding inputs, neither of which this session has
> direct access to produce, are supplied: Turn 1's full sanitised
> diagnostic block, and a durable `audit_events` query confirming the
> writes. See "Outstanding before this can be marked passing" at the end
> of that section.
>
> Do **not** record credentials, message bodies, or any user-sensitive content
> in this file. Only the structured fields below.
>
> This template does not, by itself, satisfy issue #14. #14 is closed only
> once this document (or an equivalent record) is filled in with a genuine
> passing run and the issue is updated accordingly.

## How to use this template

1. Run the smoke-test procedure from issue #14 against a disposable project
   and a non-production account/environment, using this gate branch
   (`gate/t11-live-provider-smoke`) so the request is shaped exactly as the
   product's actual configuration sends it — GENU's selected model, current
   prompt and strict tool schemas, unmodified for the test.
2. Fill in every field below from what actually happened — not from what was
   expected to happen.
3. If any step fails or the provider behaves incompatibly, stop, leave this
   template unfilled (or mark it failed), and open a separately classified
   issue describing the failure. Do not close #14.
4. If every step passes, fill this file in completely and commit it on
   **this gate branch/PR** (`gate/t11-live-provider-smoke`), then close #14
   from here. #14 itself is explicit that no T11 implementation branch may
   be created and no T11 implementation PR may be opened while it remains
   open — evidence and closure have to happen before that branch exists, not
   inside it. Only once #14 is closed does T11 implementation begin, on a
   fresh branch, in a separate PR.

---

## Attempt log

Failed or inconclusive attempts are recorded here as they happen, and are
never removed or overwritten by a later attempt — including a later passing
one. This section is evidence of what was actually tried; the "Run metadata"
/ "Acceptance criteria checklist" sections below remain reserved for a
genuine **passing** run only, and stay unfilled until one occurs.

### Attempt 1 — FAILED (Turn 1)

- Result: **FAILED.** Not passing evidence. Does not satisfy #14.
- Model: `claude-opus-5` (GENU's actual configured model, unmodified for
  the test)
- Prompt version: `discovery/2026-07-30.1`
- Project: `b03c0633-cc1f-4f6e-9faa-2c07625154e7` (disposable)
- Turn: `3c3ce9d9-0178-435e-9908-984edcee9850`
- Observed UI outcome: "The response could not be completed. Your message
  is saved — try again in a moment."
- Sanitised diagnostics: `toolCalls: 0`, `toolNames: []`,
  `requestedToolNames: []`, `providerRounds: 1`, `schemaRetries: 0`,
  `inputTokens: 0`, `outputTokens: 0`, `latencyMs: 180`, `outcome: failed`,
  `errorCode: engine_unavailable`
- Cause: not yet determined at the time of this attempt. `errorCode:
  engine_unavailable` was the only classification available —
  `providerError()` collapsed every provider failure other than a rate
  limit or an authentication failure into that single code, so a genuine
  request-shape incompatibility (400/404/422), a provider-side outage
  (5xx) and a connection failure were indistinguishable from each other.
- Follow-up: added `TurnDiagnostics.providerFailure` (SDK error class, HTTP
  status, the API's own closed-vocabulary error type, request id — never
  provider-authored message/body text) so a rerun can identify which of
  these this was. See commit history on this branch. Turn 1 will be rerun
  once against the corrected Preview and the new diagnostic read to
  identify the actual incompatibility, per Jamie's instruction not to
  re-attempt repeatedly without a diagnosis in hand.

### Attempt 2 — FAILED (Turn 1)

- Result: **FAILED.** Not passing evidence. Does not satisfy #14.
- Model: `claude-opus-5` (GENU's actual configured model, unmodified for
  the test)
- Prompt version: `discovery/2026-07-30.1`
- Project: `752b11f8-c4fb-4aac-b30b-9a25cb5572b3` (fresh disposable project)
- Turn: `b14b78d1-b65c-4434-bd95-5d4b25b76c54`
- Sanitised diagnostics: `toolCalls: 0`, `toolNames: []`,
  `requestedToolNames: []`, `providerRounds: 1`, `schemaRetries: 0`,
  `inputTokens: 0`, `outputTokens: 0`, `latencyMs: 179`, `outcome: failed`,
  `errorCode: engine_unavailable`, `providerFailure: { status: 400,
  errorType: "invalid_request_error", requestId:
  "req_011Ce58J7WNRpkbaD7VzUNED" }`
- Cause, confirmed: the new `providerFailure` diagnostic showed Anthropic
  rejecting the request itself — a 400 `invalid_request_error` before any
  tokens were processed (fast, 179ms). Compared the live request shape
  against Anthropic's documented strict-tool-use JSON Schema subset
  (`platform.claude.com/docs/en/build-with-claude/structured-outputs`,
  fetched directly rather than assumed from training data). Confirmed:
  `maxItems` — and `minItems` above 1 — are outside the supported subset
  ("array constraints beyond minItems of 0 or 1" are not supported) and
  reject the *entire* request, not just the array carrying them. Five of
  `DISCOVERY_TOOLS`' eight provider-facing schemas
  (`update_project_model`, `record_assumption`, `propose_connected_change`,
  `suggest_actions`, `recommend_canvas_scene`) used `maxItems`, so every
  live request — which always sends the full tool catalogue — was rejected
  before inference could begin, independent of anything in the message or
  the conversation.
- Fix: removed `maxItems` (and no `minItems` above 1 remained) from all six
  affected array schemas in `DISCOVERY_TOOLS`
  (`src/lib/ai/tools/discovery-tools.ts`). The equivalent bounds are
  unchanged and still enforced at the Zod validation boundary
  (`.max(8)`/`.max(5)`/`.max(12)`/`.max(3)`/`.max(60)`/`.max(200)`), which
  was always the real enforcement point per this file's own documented
  design (the provider schema is a hint, not the boundary) — so this is a
  pure request-shape fix with no change to what a turn may actually do.
  Added a regression test suite (`discovery-tools.test.ts`) that walks
  every provider-facing schema and asserts it stays inside the documented
  strict-mode subset (no `maxItems`, no `minItems` above 1, no unsupported
  numeric/string-length constraints, `additionalProperties: false` and a
  complete `required` list on every object), so this class of
  incompatibility cannot silently return.
- Status: fix pushed to this gate branch. Turn 1 has not yet been rerun
  against the corrected Preview.

---

## Successful run — Test 5

Project `49515f23-495d-4a8c-b2de-0f6585628731`, disposable, on head
`4e88dfc`. Model `claude-opus-5`, prompt version `discovery/2026-07-30.1`
throughout.

### Turn 1 — initial problem

Reported as a behavioural PASS (comment
`Jamie-Bell-14/GENU#20#issuecomment-5307615855`: "Turn 1 passed"). The full
sanitised diagnostic block for this turn (turn id, token usage, latency,
`toolNames`/`requestedToolNames`) has not been posted to the PR the way
Attempts 1–2 and Turns 2–3 were — see "Outstanding" below.

### Turn 2 — assumption, alternatives, stored context

Reported turn id `6bb2ec74-f802-40cc-804c-cb068a3edf69`.

- `toolNames`: `update_project_model`, `record_assumption`,
  `suggest_actions`
- `requestedToolNames`: same three
- `providerRounds: 3`, `schemaRetries: 0`
- `inputTokens: 16842`, `outputTokens: 1378`, `latencyMs: 23853`
- `outcome: completed`

Behavioural result: **PASS.** The response used prior project context,
treated the person's claim as a hypothesis rather than settled fact,
challenged it, offered credible alternatives, recorded an assumption,
updated the canvas, and surfaced exactly three application-owned actions.

**Deviation found:** the stored assumption's `statement` contained
JSON-key-like residue appended after the genuine sentence (e.g. `...larger
ones.", "whyItMatters":"placeholder`), despite zero schema retries. Traced
in code (`src/lib/services/model-operations.ts`, `record_assumption` case):
`statement` and `why_it_matters` are stored independently with no
application-side string concatenation, so this was content the live model
itself generated inside an otherwise schema-valid string — not a
provider-contract or application defect. Tracked separately as
[issue #21](https://github.com/Jamie-Bell-14/GENU/issues/21); not a #14
acceptance blocker.

### Turn 3 — steering

Reported turn id `9cfec7bb-e3db-4541-ac9e-60ed56bfb326`, project
`49515f23-495d-4a8c-b2de-0f6585628731`.

- `providerRounds: 2`, `schemaRetries: 0`
- `inputTokens: 12065`, `outputTokens: 1892`, `latencyMs: 35752`
- `outcome: completed`, `errorCode`: none

A `POST /api/projects/49515f23-495d-4a8c-b2de-0f6585628731/directions`
returned `200` roughly 10 seconds into the active turn. The response
pivoted to the requested angle within the same live response, not merely
after the turn completed.

Behavioural result: **PASS.** One direction was accepted during an active
live turn and visibly influenced that same turn's response; no false claim
of application was observed.

### Outstanding before this can be marked passing

This session cannot generate either of the following itself — no database
credentials to the Preview Supabase project, and no diagnostic source for
Turn 1 beyond the pass/fail summary already posted:

1. **Turn 1's full sanitised diagnostic block** — turn id, token usage,
   latency, `toolNames`/`requestedToolNames`, matching the shape already
   recorded for Attempts 1–2 and Turns 2–3 above.
2. **Durable `audit_events` confirmation** for project
   `49515f23-495d-4a8c-b2de-0f6585628731`:
   `select created_at, action, target, correlation_id, detail from audit_events where project_id = '49515f23-495d-4a8c-b2de-0f6585628731' order by created_at;`
   — looking for `operation_applied` rows (with `count`) correlated to the
   Turn 1 field write and the Turn 2 assumption write, and any honest
   `operation_rejected` rows.

---

## Run metadata

Shared across Turns 1–3 of the Test 5 run; per-turn token/latency/outcome
figures are in "Successful run — Test 5" above (Turn 1's own figures are
part of the outstanding items).

| Field | Value |
|---|---|
| Model identifier | `claude-opus-5` |
| Prompt version (`DISCOVERY_PROMPT_VERSION`) | `discovery/2026-07-30.1` |
| Date | 2026-08-15 |
| Environment (deployment, not account credentials) | Vercel Preview for `gate/t11-live-provider-smoke`, head `4e88dfc` |
| Provider request outcome | Turn 1: reported PASS, diagnostics outstanding. Turns 2–3: `completed`, `errorCode` none |
| Token usage (input / output) | Turn 1: outstanding. Turn 2: 16842 / 1378. Turn 3: 12065 / 1892 |
| Latency | Turn 1: outstanding. Turn 2: 23853ms. Turn 3: 35752ms |
| Tool names requested (validated names only — never arguments) | Turn 2: `update_project_model`, `record_assumption`, `suggest_actions` (both `toolNames` and `requestedToolNames`) |

## Exercised scenarios (issue #14 procedure)

For each row: pass / fail, and a one-line factual note (no message bodies).
Rows marked PASS (reported) rely on the behavioural description already
posted to the PR rather than a diagnostic this session independently
verified — see "Outstanding" above.

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | New empty project + real user message describing a problem | PASS (reported) | Turn 1; full diagnostics outstanding |
| 2 | Live reflection distinguishes user-stated content from inference | PASS (reported) | Turn 1 |
| 3 | Sparse project-field update | PASS (reported) | Turn 1 |
| 4 | Specific recorded assumption with an alternative explanation | PASS | Turn 2; assumption + alternatives + challenge recorded. Deviation: issue #21 (content residue, not an acceptance blocker) |
| 5 | No more than three application-owned contextual actions | PASS | Turn 2; exactly three surfaced |
| 6 | Post-commit canvas refresh during the same turn | PASS (reported) | Turn 2 ("updated the canvas"); durable confirmation via `audit_events` outstanding |
| 7 | Follow-up turn using stored project context | PASS | Turn 2; response engaged with prior context, not a re-ask |
| 8 | One steering direction while a live turn is running | PASS | Turn 3; direction accepted mid-turn, response pivoted within the same response |

## Validation and commit outcomes

- Structured tool output validated by the application boundary without manual
  database intervention: yes — all three turns completed with `schemaRetries: 0`
  where reported (Turns 2–3; Turn 1 outstanding), meaning the live model's
  output validated on the first pass.
- Field and assumption committed transactionally and visible on the canvas in
  the same turn: reported yes (Turn 1 field, Turn 2 assumption); durable
  `audit_events` confirmation outstanding (see above).
- Provenance shown in the application matches what the host derived, not what
  the model claimed: reported yes (Turn 2's assumption correctly treated as a
  hypothesis, not asserted as fact); not independently re-derived by this
  session.
- Contextual actions resolved from the application catalogue, capped at
  three: yes — Turn 2 surfaced exactly three.
- Follow-up turn received the prior project state correctly: yes — Turn 2's
  response engaged with the problem established in Turn 1 rather than
  re-asking.
- Steering was honestly applied or honestly refused according to the
  established window: yes — Turn 3's direction was applied within the same
  live response, confirmed via the `POST .../directions` 200 and the
  response's content, not merely claimed.

## Steps 2–3 acceptance

- [ ] Passed — not checked yet. All three turns behaviourally passed, but
      per this document's own rule this box moves to checked only once the
      durable `audit_events` evidence and Turn 1's full diagnostics are in
      hand (see "Outstanding" above), not on behavioural description alone.
- [ ] Failed

## Deviations or provider incompatibilities found

- Turn 2's stored assumption `statement` contained JSON-key-like residue
  appended after the genuine sentence (schema-valid, zero schema retries —
  content contamination, not a provider-contract or application defect;
  traced in `model-operations.ts`, no app-side concatenation found).
  Tracked as [issue #21](https://github.com/Jamie-Bell-14/GENU/issues/21).
  Not treated as a #14 acceptance blocker.
- No provider/schema incompatibility found in Turns 1–3 of this run (the
  Attempt 1–2 incompatibility was fixed prior to this run — see "Attempt
  log").

## Acceptance criteria checklist (issue #14)

Left unchecked pending the two outstanding items above, per this
document's own rule not to move from NOT PASSING until durable evidence
supports it. Each line notes its current basis.

- [ ] A controlled live-provider turn completes on a disposable empty project.
      (Reported PASS, Turn 1; full diagnostics outstanding.)
- [ ] The live model produces usable structured output through the existing
      validation boundary without manual database intervention.
      (`schemaRetries: 0` on Turns 2–3; Turn 1 outstanding.)
- [ ] The field and assumption are committed transactionally and visible on
      the canvas during the same turn.
      (Reported yes; durable `audit_events` confirmation outstanding.)
- [ ] Provenance shown in the application matches what the host derived, not
      what the model claimed. (Reported yes, Turn 2.)
- [ ] Contextual actions are resolved from the application catalogue and
      capped at three. (Confirmed, Turn 2 — exactly three.)
- [ ] A live follow-up turn receives the prior project state correctly.
      (Confirmed, Turn 2.)
- [ ] Steering is either honestly applied or honestly refused according to
      the established window. (Confirmed, Turn 3.)
- [ ] Recorded evidence includes model, prompt version, usage, latency and
      acceptance result without message bodies. (Complete for Turns 2–3;
      Turn 1 outstanding.)
- [ ] Any failure discovered becomes a separately classified issue before T11
      implementation proceeds. (Done — issue #21 for the content-residue
      deviation.)
- [ ] This gate PR/branch (`gate/t11-live-provider-smoke`) explicitly
      references and closes #14, before any T11 implementation branch or PR
      is created.[^1]

[^1]: Issue #14's own body still states "The first T11 PR explicitly
    references and closes #14," which contradicts its own rule against
    opening a T11 implementation PR while #14 is open. This checklist item
    has been reworded here to the sequence actually usable under that rule.
    The issue's own wording has not been changed — that requires an
    explicit issue-body update, which is Jamie's call, not something a PR
    comment or this template can resolve on #14's behalf.
