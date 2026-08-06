# Issue #14 — T11 Entry Gate: Live-Provider Smoke Test Evidence

> Status: **EMPTY TEMPLATE.** Not run. No fields below are filled in — this file
> exists only so the evidence issue #14 requires has a fixed, reviewable shape
> to fill in once the controlled live-provider test is run in a secure
> non-production deployment environment.
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
   (`gate/t11-live-provider-smoke`) so the request is shaped for the pinned
   Claude Haiku 4.5 model.
2. Fill in every field below from what actually happened — not from what was
   expected to happen.
3. If any step fails or the provider behaves incompatibly, stop, leave this
   template unfilled (or mark it failed), and open a separately classified
   issue describing the failure. Do not close #14.
4. If every step passes, fill this file in completely, commit it on the T11
   implementation branch's first PR, and reference/close #14 from that PR.

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
- [ ] The first T11 PR explicitly references and closes #14.
