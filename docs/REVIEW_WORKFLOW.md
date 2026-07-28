# Review and Change Workflow

## Purpose

This workflow provides a lightweight communication path between Jamie, GPT and Claude Code without turning review history into another source of truth.

- GitHub issues hold review discussion and the current review state.
- Canonical documents hold approved product and engineering direction.
- Pull requests show proposed changes for Jamie to approve.
- Implementation begins only after the relevant canonical-document changes are approved and merged.

Individual reviews do not become permanent Markdown files in the repository. The issue body is the maintained summary; comments preserve the historical discussion.

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

### Claude Code — technical respondent and implementer

- Responds to review findings with evidence, risks, alternatives and an implementation proposal.
- Challenges recommendations where they create unnecessary complexity or conflict with the repository.
- Does not implement review findings before Jamie approves them.
- Does not independently rewrite canonical product direction during a review.
- Implements from approved, merged canonical documents.
- Reports what changed, tests performed, limitations and deviations.

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

## Lifecycle

1. **GPT opens a review issue** tied to a specific commit or branch.
2. **Claude responds** using `docs/CLAUDE_REVIEW_PROTOCOL.md`.
3. **GPT updates the issue body** with the current summary and open decisions.
4. **Jamie decides**: approve, approve with changes, reject or defer.
5. **GPT creates a documentation-only branch and pull request** updating every affected canonical document together.
6. **Jamie reviews and merges the documentation pull request.** The merged documents become the requirement.
7. **Claude creates a separate implementation branch and pull request.**
8. **GPT verifies** the implementation against the issue decision and canonical documents.
9. **Jamie approves and merges** the implementation pull request.
10. **GPT closes the issue** after verification or records remaining follow-up work.

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

## Pull-request rules

- Never write review-driven changes directly to `main`.
- Documentation changes and implementation changes use separate pull requests.
- Documentation PRs must link the review issue and describe the exact approved decision.
- Implementation PRs must link both the review issue and merged documentation PR.
- Do not mix unrelated improvements into either PR.
- Do not merge automatically.
- Any material deviation from approved documents must return to Jamie for a decision.

## Context and reading scope

For an active review, read only:

- the active issue body
- comments added after the latest issue-body summary when necessary
- the affected canonical documents
- the implementation or screenshots under review

Closed review issues do not need to be reread unless a later issue explicitly depends on them. Approved conclusions should already be present in canonical documents.
