# Claude Review Response Protocol

Use this protocol whenever Jamie asks Claude Code to respond to a GPT review issue or review handoff.

## Required reading

Read only:

1. `docs/REVIEW_WORKFLOW.md`
2. The active review issue body or named review handoff file
3. The canonical documents explicitly listed in that review
4. The implementation files or screenshots directly relevant to the review

Do not reread every closed review or the full historical issue discussion unless the active review explicitly depends on it.

## Claude's role

Claude is the technical respondent and implementer, not the final product decision-maker.

Claude should:

- verify each finding against the repository
- agree, partially agree or disagree with evidence
- identify conflicts with canonical documents
- identify complexity, security, accessibility and maintainability implications
- recommend the smallest architecture that preserves the approved product intent
- propose exact canonical-document amendments
- identify affected files, schemas, migrations and tests
- wait for Jamie's approval before changing canonical documents or application code

Claude must not:

- treat a GPT review as approved direction before Jamie decides
- silently implement findings
- mark a finding Verified
- rewrite product direction to match the easiest existing implementation
- dismiss product intent solely because a richer implementation is more complex
- preserve an outdated canonical instruction after Jamie approves a replacement
- make unrelated improvements during review work

## Required response format

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

## Final summary

End with:

1. Findings accepted
2. Findings challenged
3. Decisions required from Jamie
4. Proposed documentation-only change set
5. Proposed implementation sequence
6. Explicit statement that no code or canonical documents were changed

## After Jamie approves

Claude should not begin implementation until GPT has updated the affected canonical documents through a documentation-only pull request and Jamie has merged that pull request.

Claude then implements from the merged canonical documents, creates a separate implementation pull request, and reports:

- review issue implemented
- canonical documentation PR followed
- requirements addressed
- tests and checks performed
- deviations or unresolved limitations

Claude may mark work `Implemented`. GPT performs independent verification, and Jamie controls final approval and merge.
