# Review and Change Workflow

## Purpose

This workflow provides a lightweight communication path between Jamie, GPT and Claude Code without turning review history into another source of truth.

- GitHub issues hold review discussion and the current review state.
- Canonical documents hold approved product and engineering direction.
- Pull requests show proposed changes for Jamie to approve.
- Implementation begins only after the relevant canonical-document changes are approved and merged.

Individual reviews do not become permanent Markdown files in the repository. The issue body is the maintained summary; comments preserve the historical discussion.

The review process is intended to find contradictions across the whole user journey, not only defects visible in the latest diff. A locally correct patch is not sufficient when another consumer of the same state remains inconsistent.

## Roles

### Jamie — decision owner

- Approves, modifies, rejects or defers review recommendations.
- Approves all canonical-document changes.
- Approves all implementation changes.
- Is the only person who can declare a product-direction decision accepted.

### GPT — independent reviewer and documentation owner

- Reviews the current implementation, screenshots and relevant canonical documents.
- Opens one GitHub issue per review topic.
- Maintains the issue body as the concise current state.
- Drafts canonical-document changes after Jamie approves the direction.
- Creates documentation-only pull requests.
- Verifies Claude's implementation against the approved documents and review decision.
- Reviews feature invariants across every consumer of the same state, including live state, reload, recovery, model-facing wording, contextual actions, canvas behaviour and database eligibility.
- Rechecks the complete invariant after a fix rather than approving from the latest patch alone.

### Claude Code — technical respondent and implementer

- Responds to review findings with evidence, risks, alternatives and an implementation proposal.
- Challenges recommendations where they create unnecessary complexity or conflict with the repository.
- Does not implement review findings before Jamie approves them.
- Does not independently rewrite canonical product direction during a review.
- Implements from approved, merged canonical documents.
- Reports what changed, tests performed, limitations and deviations.
- Supplies the review contract and state matrix required below for cross-cutting implementation work.
- When fixing a finding, checks every surface that derives from the affected state rather than changing only the line named in the review.

## Review records

Each review uses one GitHub issue with an identifier such as:

- `REV-001 — Adaptive canvas architecture`
- `REV-002 — Workspace prototype`
- `REV-003 — Research experience`

The issue body is kept concise and contains:

1. Current status
2. Executive verdict
3. Material reviewed
4. Findings and recommended actions
5. Decisions required from Jamie
6. Canonical documents affected
7. Linked documentation and implementation pull requests
8. Latest agreed direction

Comments contain discussion and historical reasoning. Once the issue body has been updated, agents should not reread the full comment history unless a specific unresolved point requires it.

For implementation pull requests, all review submissions and implementation responses on the active PR must be read before a final verdict. Earlier rounds may define constraints that are no longer visible in the latest diff.

## Statuses

Use one of these statuses in the issue body:

- `Awaiting Claude response`
- `Awaiting Jamie decision`
- `Documentation proposed`
- `Approved for implementation`
- `Implementation in progress`
- `Awaiting verification`
- `Verified`
- `Deferred`
- `Closed`

Claude may mark work `Implemented`; only GPT may recommend `Verified`, and Jamie remains the final merge approver.

## Implementation review contract

Every material or cross-cutting implementation pull request must include a `Review contract` section in its description before it is treated as ready for independent review.

The contract must contain:

1. **Scope and sources of truth** — the task, issue, approved documents and explicit exclusions.
2. **Feature invariants** — statements that must remain true across every path.
3. **State or scenario matrix** — normal, empty, failure, interruption, reload and supersession cases that materially affect the feature.
4. **Surface map** — every layer that consumes or derives the relevant state.
5. **Test evidence** — the exact test or check proving each material row.
6. **Known limitations and untested boundaries** — stated plainly rather than hidden by a green suite.
7. **Exit gates and linked issues** — including their current open or closed state.

A recommended matrix format is:

| Scenario | Expected UI/action | Expected model wording | Server/database eligibility | Reload/recovery outcome | Test |
| --- | --- | --- | --- | --- | --- |
| Normal path |  |  |  |  |  |
| Empty or missing context |  |  |  |  |  |
| Failure or interruption |  |  |  |  |  |
| Later/superseding action |  |  |  |  |  |

The matrix should be tailored to the feature. It is not a requirement to invent meaningless cases.

## Core invariants

Use the following invariants whenever they apply:

- An application-owned action is visible or suggested only when its server operation is currently valid.
- Model-facing statements describe actual application state, not an intended or likely state.
- Live state, reload hydration and recovery produce equivalent eligibility and meaning.
- Failed, stopped, expired or superseded work cannot leave contradictory UI, model wording or durable state.
- State belonging to one turn, pass, request or object cannot silently fall back to an older one.
- The client, model context, route/service layer and database must agree on identity, currency and outcome.
- A successful database write must have a truthful and recoverable user-visible outcome.
- A failed operation must not be described as successful, and a successful operation must not be described as having changed nothing.
- Application-owned labels, actions and scenes must not promise behaviour the current state cannot fulfil.

Feature-specific invariants should be added rather than forcing every review into only this list.

## Surface map

For each material invariant, inspect all relevant consumers together rather than reviewing them as isolated files:

- canonical documentation and PR description
- database schema, constraints, transactions and RLS
- route, service and application-owned validation
- live client reducer and hook state
- initial page load and reload hydration
- recovery, catch-up, retry, stop and connection-loss paths
- contextual actions and application-owned labels
- model context, tool results and user-facing AI wording
- canvas scene recommendation, queue, acceptance and invalidation
- audit, provenance and inspectability
- unit, integration, RLS and end-to-end coverage

A change to one of these surfaces requires checking the others that derive from the same state, even when they are outside the latest commit.

## First-review method

The first independent review of an implementation PR should be a whole-feature review, not a sequence of isolated line comments.

GPT should:

1. Read the active issue, current PR description, all review rounds on the PR and the affected canonical documents.
2. Identify the user journey, durable boundaries, trust boundaries and lifecycle identities.
3. Restate the feature invariants independently of the implementation.
4. Build or validate the scenario matrix, adding missing cases.
5. Trace each invariant end to end through every relevant surface.
6. Check seams between layers, not only the correctness of each layer in isolation.
7. Verify tests exercise real joins between boundaries where a mocked unit test could allow incompatible halves to pass separately.
8. Check normal, empty/no-context, failure, interruption, reload, retry and supersession paths where applicable.
9. Check the exact PR head and its CI, required gates and linked issue state.
10. Produce one consolidated review grouped by priority and root invariant.

Do not deliberately hold back known lower-priority findings for later rounds. Include all supported P0, P1 and P2 findings in the same review so Claude can action the complete set.

## Re-review method

A re-review starts with the latest diff but does not end there.

For every claimed fix, GPT must:

1. Verify the exact changed code and test.
2. Identify the invariant the fix is meant to restore.
3. Recheck every consumer of the affected state across the surface map.
4. Re-run the relevant scenario rows, including reload and recovery equivalents.
5. Confirm documentation and the PR description now match the implemented rule.
6. Distinguish whether any new finding was introduced by the latest patch or was a pre-existing latent defect exposed by the broader sweep.
7. Confirm the exact-head CI result and exit gates again.

Approval must not be based only on Claude's summary, a green CI result or the local correctness of the newest commit.

## Priority model

Use priorities consistently:

- **P0 — blocking correctness or trust failure.** Project truth can be corrupted, security or isolation can fail, an irreversible/atomicity guarantee is false, or the central accepted journey makes a materially false claim.
- **P1 — blocking product or lifecycle inconsistency.** A supported path can produce contradictory UI/server behaviour, reload/recovery differs materially from live state, an action is offered when it cannot work, or canonical documentation no longer describes the system.
- **P2 — important but safely deferrable.** The issue has a safe recovery or does not block the accepted journey, and its owner plus delivery gate are recorded explicitly.

Do not downgrade a finding only because it occurs on an edge path when that path is reachable and contradicts product truth.

## Large and cross-cutting pull requests

Prefer linked, independently reviewable pull requests when a feature spans several major boundaries such as AI orchestration, database transactions, client lifecycle, reload hydration and canvas behaviour.

A split should preserve a usable vertical sequence rather than create dead intermediate controls. Appropriate boundaries commonly include:

1. runtime or provider orchestration
2. durable storage, eligibility and hydration
3. consequential mutation and canonical model integration

When the work remains in one PR, the description must explain why and the full review contract becomes mandatory. A large PR is not exempt from complete review because it is difficult to inspect.

## Lifecycle

1. **GPT opens a review issue** tied to a specific commit or branch.
2. **Claude responds** using `docs/CLAUDE_REVIEW_PROTOCOL.md`.
3. **GPT updates the issue body** with the current summary and open decisions.
4. **Jamie decides**: approve, approve with changes, reject or defer.
5. **GPT creates a documentation-only branch and pull request** updating every affected canonical document together.
6. **Jamie reviews and merges the documentation pull request.** The merged documents become the requirement.
7. **Claude creates a separate implementation branch and pull request**, including the implementation review contract.
8. **GPT performs the whole-feature first review** against the issue decision, canonical documents, invariants and state matrix.
9. **Claude actions the complete review**, updates tests and the PR description, then reports the invariant-level regression sweep.
10. **GPT re-reviews the exact head**, checking the latest patch and every related consumer.
11. **Jamie approves and merges** the implementation pull request after GPT recommends verification.
12. **GPT closes the issue** after verification or records remaining follow-up work with an explicit owner and gate.

## Verification and merge readiness

GPT may recommend `Verified` only when:

- all accepted scope and invariants are satisfied
- every unresolved P0 and P1 has been fixed or explicitly accepted by Jamie
- deferred P2 findings have a recorded owner and blocking date/task/release gate
- the PR description reflects the current implementation rather than historical iterations
- canonical documents and implementation comments describe the same rule
- required tests and exact-head CI are green
- required issue gates are closed
- no unrelated scope was silently introduced

A green test suite is necessary but not sufficient. It proves only the scenarios the suite actually exercises.

## Canonical-document rules

Canonical requirements live only in the established source-of-truth documents, including as applicable:

- `PROJECT_PLAN.md`
- `DESIGN.md`
- `DEVELOPMENT_STANDARDS.md`
- `SECURITY_STANDARDS.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_SYSTEM.md`
- `docs/VERTICAL_SLICE_SPEC.md`
- `docs/VERTICAL_SLICE_TASKS.md`
- `docs/UI_ACCEPTANCE_CRITERIA.md`

Review issues and comments are proposals and decision records, not permanent implementation authority. Once Jamie approves a direction, GPT must update all affected canonical documents and remove contradictions rather than adding another overlapping instruction.

`docs/REVIEW_WORKFLOW.md` and `docs/CLAUDE_REVIEW_PROTOCOL.md` govern review mechanics. They do not override approved product, security or architecture direction.

## Pull-request rules

- Never write review-driven changes directly to `main`.
- Documentation changes and implementation changes use separate pull requests.
- Documentation PRs must link the review issue and describe the exact approved decision.
- Implementation PRs must link both the review issue and merged documentation PR.
- Implementation PRs must contain the review contract required above.
- Do not mix unrelated improvements into either PR.
- Do not merge automatically.
- Any material deviation from approved documents must return to Jamie for a decision.
- After review feedback, update the PR description so it describes the current proposed implementation, not a chronological patch log alone.

## Context and reading scope

For a product or architecture review, read:

- the active issue body
- comments added after the latest issue-body summary when necessary
- the affected canonical documents
- the implementation or screenshots under review

For an implementation PR verification, also read:

- the current PR description
- all submitted reviews and implementation responses on that PR
- the full current diff or changed-file set
- files outside the latest commit that consume the affected state
- exact-head CI and linked issue gates

Closed review issues do not need to be reread unless a later issue explicitly depends on them. Approved conclusions should already be present in canonical documents.
