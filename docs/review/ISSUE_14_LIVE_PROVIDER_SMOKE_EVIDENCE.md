# Issue #14 — T11 Entry Gate: Live-Provider Smoke Test Evidence

> Status: **NOT PASSING.** Two live attempts have been made and failed (see
> "Attempt log" below). Attempt 2's cause is identified and fixed on this
> branch (an unsupported JSON Schema keyword in the strict tool
> definitions); the fix has not yet been re-verified against a live turn.
> The "Run metadata" / "Acceptance criteria checklist" sections remain
> unfilled — they exist only so the evidence issue #14 requires has a
> fixed, reviewable shape to fill in once a controlled live-provider test
> genuinely passes.
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

## Run metadata

| Field | Value |
|---|---|
| Model identifier | |
| Prompt version (`DISCOVERY_PROMPT_VERSION`) | |
| Date | |
| Environment (deployment, not account credentials) | |
| Provider request outcome | |
| Token usage (input / output) | |
| Latency | |
| Tool names requested (validated names only — never arguments) | |

## Exercised scenarios (issue #14 procedure)

For each row: pass / fail, and a one-line factual note (no message bodies).

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | New empty project + real user message describing a problem | | |
| 2 | Live reflection distinguishes user-stated content from inference | | |
| 3 | Sparse project-field update | | |
| 4 | Specific recorded assumption with an alternative explanation | | |
| 5 | No more than three application-owned contextual actions | | |
| 6 | Post-commit canvas refresh during the same turn | | |
| 7 | Follow-up turn using stored project context | | |
| 8 | One steering direction while a live turn is running | | |

## Validation and commit outcomes

- Structured tool output validated by the application boundary without manual
  database intervention: 
- Field and assumption committed transactionally and visible on the canvas in
  the same turn: 
- Provenance shown in the application matches what the host derived, not what
  the model claimed: 
- Contextual actions resolved from the application catalogue, capped at
  three: 
- Follow-up turn received the prior project state correctly: 
- Steering was honestly applied or honestly refused according to the
  established window: 

## Steps 2–3 acceptance

- [ ] Passed
- [ ] Failed (see separately classified issue: #___)

## Deviations or provider incompatibilities found

_(None recorded yet — fill in after the run, or state "none found.")_

## Acceptance criteria checklist (issue #14)

- [ ] A controlled live-provider turn completes on a disposable empty project.
- [ ] The live model produces usable structured output through the existing
      validation boundary without manual database intervention.
- [ ] The field and assumption are committed transactionally and visible on
      the canvas during the same turn.
- [ ] Provenance shown in the application matches what the host derived, not
      what the model claimed.
- [ ] Contextual actions are resolved from the application catalogue and
      capped at three.
- [ ] A live follow-up turn receives the prior project state correctly.
- [ ] Steering is either honestly applied or honestly refused according to
      the established window.
- [ ] Recorded evidence includes model, prompt version, usage, latency and
      acceptance result without message bodies.
- [ ] Any failure discovered becomes a separately classified issue before T11
      implementation proceeds.
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
