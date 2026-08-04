# Claude Review Response Protocol

Use this protocol whenever Jamie asks Claude Code to respond to a GPT review issue, review handoff or implementation pull-request review.

## Required reading

For a product or architecture review, read:

1. `docs/REVIEW_WORKFLOW.md`
2. The active review issue body or named review handoff file
3. The canonical documents explicitly listed in that review
4. The implementation files or screenshots directly relevant to the review

For implementation work or a response to pull-request feedback, also read:

5. The current pull-request description
6. Every submitted review and implementation response on the active pull request
7. The complete current changed-file set, not only the latest commit
8. Files outside the latest commit that consume or derive the affected state
9. Exact-head CI and linked issue gates

Do not reread every closed review unless the active review explicitly depends on it. Do not skip earlier rounds on the active implementation PR: they may contain constraints that the newest diff no longer shows.

## Claude's role

Claude is the technical respondent and implementer, not the final product decision-maker or independent verifier.

Claude should:

- verify each finding against the repository
- agree, partially agree or disagree with evidence
- identify conflicts with canonical documents
- identify complexity, security, accessibility and maintainability implications
- recommend the smallest architecture that preserves the approved product intent
- propose exact canonical-document amendments
- identify affected files, schemas, migrations and tests
- wait for Jamie's approval before changing canonical documents or application code when the review is still at decision stage
- define feature invariants before implementing cross-cutting work
- trace each invariant through every consumer of the affected state
- include a state/scenario matrix and test evidence in the implementation PR
- distinguish a defect introduced by the newest patch from a pre-existing latent defect exposed by review

Claude must not:

- treat a GPT review as approved direction before Jamie decides
- silently implement findings while the review is awaiting Jamie's decision
- mark a finding Verified
- rewrite product direction to match the easiest existing implementation
- dismiss product intent solely because a richer implementation is more complex
- preserve an outdated canonical instruction after Jamie approves a replacement
- make unrelated improvements during review work
- assume a local patch resolves an invariant without checking its other consumers
- rely on green CI as proof for scenarios the tests do not exercise
- describe only the newest diff when the current feature behaviour depends on earlier commits

## Product or architecture review response format

For every finding, respond with:

### Finding `<ID>` — `<title>`

**Position:** Agree | Partially agree | Disagree

**Repository evidence**

State exactly what files, components, schemas or tests support the position.

**Assessment**

Explain whether the issue is:

- an implementation defect
- an incomplete planned feature
- a documentation gap
- an architecture problem
- a product decision requiring Jamie
- or an unnecessary recommendation

**Recommended resolution**

Propose the strongest practical resolution. Distinguish immediate vertical-slice work from post-slice scope.

**Canonical documents affected**

List exact files and sections that would need amendment if Jamie approves.

**Implementation impact**

List likely files, schemas, migrations, dependencies and tests.

**Risks or alternatives**

State meaningful trade-offs without using complexity as an automatic reason to reject the product direction.

## Before requesting implementation review

Before asking GPT to review a material implementation PR, Claude must update the PR description with a `Review contract` containing:

1. **Scope and source documents**
2. **Explicit exclusions and deferred work**
3. **Feature invariants**
4. **State/scenario matrix**
5. **Surface map**
6. **Test evidence for each material scenario**
7. **Known limitations and untested boundaries**
8. **Exit gates and linked issue states**

At minimum, consider these scenario families where they apply:

- normal focused path
- empty, missing-context or no-target path
- first use and repeated/superseding use
- success, refusal and idempotent retry
- provider, validation, database and rendering failure
- stop, timeout, expired lease and lost connection
- live state, reload hydration and catch-up recovery
- concurrent or out-of-order events
- cross-project, forged or stale identity

Do not add rows merely to fill a template. Explain why a scenario family does not apply when its absence could otherwise be ambiguous.

## Required self-review before handoff

Claude must perform an invariant-level self-review before requesting GPT review.

For every important piece of state, inspect all relevant surfaces together:

- canonical documentation and PR description
- database schema, constraints, transaction and RLS
- route/service validation and trusted-writer boundary
- live reducer and hook state
- page-load and reload hydration
- recovery, retry, stop and connection-loss paths
- contextual actions and application-owned labels
- model context and tool-result wording
- canvas scene recommendation and invalidation
- audit/provenance and source inspectability
- unit, integration, RLS and end-to-end tests

The self-review should actively ask:

- Can the interface offer an action the server must refuse?
- Can the model say a view or change exists before the application has produced it?
- Can live state and reload state disagree?
- Can a later turn/pass/request leave an older result reachable?
- Can a successful write be reported as failure or a failed write be reported as success?
- Do separately passing tests prove the join between the two boundaries?
- Is the same identity and currency rule enforced in the client, server and database?

## Responding to implementation review findings

When GPT posts implementation findings, do not patch only the named line.

For each finding:

1. Identify the underlying invariant.
2. Identify the root cause rather than only the symptom.
3. List every surface that derives from the affected state.
4. Inspect the existing implementation across those surfaces before editing.
5. Implement the smallest coherent fix.
6. Add or update tests for the reported path and its live/reload/recovery equivalents where applicable.
7. Re-run the full relevant state matrix.
8. Update the PR description so it describes the current design and test evidence.
9. Report whether adjacent findings were introduced by the fix or were already latent in the branch.
10. Preserve unrelated accepted architecture and scope.

Do not stop after P0 findings when the review also contains P1 or P2 actions. Address the complete authorised review set in one pass unless Jamie explicitly narrows the scope.

## Implementation response format

For every review round, report:

### Finding `<ID>` — `<title>`

**Status:** Fixed | Partially fixed | Challenged | Deferred by explicit decision

**Root cause**

State why the mismatch existed and whether it was introduced by the latest change or already present.

**Invariant restored**

State the rule that should now hold across the whole feature.

**Affected surfaces checked**

List the database, route/service, live client, reload/recovery, model wording, contextual actions, canvas and documentation surfaces that apply.

**Changes made**

List exact files and behavioural changes.

**Tests and matrix rows**

Name the tests proving the reported case and adjacent equivalent paths.

**Remaining limitations**

State anything still unverified or deliberately deferred.

## Final summary for a product or architecture response

End with:

1. Findings accepted
2. Findings challenged
3. Decisions required from Jamie
4. Proposed documentation-only change set
5. Proposed implementation sequence
6. Explicit statement that no code or canonical documents were changed

## Final summary after implementation changes

End with:

1. Findings fixed by priority
2. Feature invariants now satisfied
3. Scenario-matrix rows added or changed
4. Exact commands and test results
5. Exact current head commit
6. Exit-gate status
7. Scope deliberately untouched
8. Remaining limitations
9. Request for independent re-review

Do not claim the work is Verified. Claude may mark work `Implemented`; GPT performs independent verification, and Jamie controls final approval and merge.

## After Jamie approves product direction

Claude should not begin implementation until GPT has updated the affected canonical documents through a documentation-only pull request and Jamie has merged that pull request.

Claude then implements from the merged canonical documents, creates a separate implementation pull request, and follows the implementation review contract in `docs/REVIEW_WORKFLOW.md`.
