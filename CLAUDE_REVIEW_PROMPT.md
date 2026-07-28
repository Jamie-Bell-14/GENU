# Claude Code Repository Review Prompt

Paste the following into Claude Code after these files are copied into the repository.

---

Read the repository before writing any application code.

Review:

- PROJECT_PLAN.md
- PROJECT_PLAN_ADDENDUM.md
- DEVELOPMENT_STANDARDS.md
- SECURITY_STANDARDS.md.
- DESIGN.md
- docs/VERTICAL_SLICE_SPEC.md
- docs/UI_ACCEPTANCE_CRITERIA.md
- CLAUDE.md
- styles/design-tokens.css
- all installed project-level skills

Installed design skills currently include:

- frontend-design
- ui-ux-pro-max
- shadcn

Your task is not to build yet.

Act as the Lead Product Engineer and Lead Product Designer.

## 1. Verify the repository

Show:

- the files you found
- the installed skills you found
- whether any referenced document is missing
- whether any skill has broken relative references
- whether the proposed file locations should change

## 2. Review the specification critically

Identify:

- contradictions
- duplicated requirements
- unrealistic requirements
- unnecessary complexity
- weak technical assumptions
- missing product decisions
- missing architecture decisions
- accessibility risks
- performance risks
- data-model risks
- AI-orchestration risks
- places where the UI may become visually or cognitively overloaded
- anything in the vertical slice that should be simplified

Do not optimise for agreeing with the documents.

Recommend the strongest product and engineering approach.

## 3. Propose the merge

Compare `PROJECT_PLAN_ADDENDUM.md` with `PROJECT_PLAN.md`.

Show:

- sections to insert
- sections to replace
- conflicts that require a decision
- wording that should be simplified

Do not overwrite `PROJECT_PLAN.md` until I approve the merge.

## 4. Propose the architecture

Provide:

- repository structure
- route structure
- component architecture
- server/client component boundaries
- state-management approach
- Supabase schema
- Row-Level Security approach
- AI-service interfaces
- research-provider abstraction
- structured-output schemas
- connected-change transaction model
- document-version model
- decision-history model
- event/activity model
- error model
- design-token integration
- test strategy
- deployment approach

Keep provider-specific code isolated.

Do not introduce a vector database unless the current vertical slice requires one and you can explain why ordinary Postgres is insufficient.

## 5. Propose the vertical-slice task plan

Break `docs/VERTICAL_SLICE_SPEC.md` into small sequential tasks.

Each task must include:

- objective
- dependencies
- files likely to change
- functional requirements
- UI/UX acceptance criteria
- edge cases
- test requirements
- out-of-scope items
- completion checklist

The task plan must build the design system and workspace primitives before the complete scenario.

## 6. Design review

Apply:

- frontend-design
- ui-ux-pro-max
- shadcn

Explain:

- the visual direction
- information hierarchy
- conversation/canvas layout
- canvas object grammar
- research-view treatment
- connected-change treatment
- activity treatment
- motion approach
- accessibility approach

Do not copy default shadcn layouts.

Do not generate generic AI SaaS styling.

## 7. Stop point

Return the review, proposed merge, architecture and task plan.

Do not write application code.

Do not change existing project files except to create clearly labelled draft proposals under `docs/review/`.

Wait for approval before implementation.

## 8. Review the proposed architecture against SECURITY_STANDARDS.md.

Include:

- authentication and session boundaries
- authorisation and ownership checks
- Supabase RLS strategy
- secret and environment-variable handling
- prompt-injection controls
- web-research and URL-fetching risks
- AI tool permissions
- validation and output rendering
- logging and redaction
- rate limiting and cost-abuse controls
- threat modelling
- security testing
- production security gates
