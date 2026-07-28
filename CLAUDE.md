# PPM — Claude Code Project Instructions

## 1. Purpose

This file contains permanent repository-level instructions for Claude Code.

Claude Code must read and follow these instructions before planning, reviewing or implementing work in this repository.

The product is an AI-guided Intelligent Product Lab that helps users move from an uncertain problem or product idea to an evidence-backed, structured and implementation-ready product plan.

The central product loop is:

> Conversation → analysis → research → visualisation → challenge → decision → project evolution

The project—not the AI personality—is the primary focus.

---

## 2. Required reading order

Before beginning any significant task, read:

1. PROJECT_PLAN.md
2. DEVELOPMENT_STANDARDS.md
3. SECURITY_STANDARDS.md
4. DESIGN.md
5. docs/VERTICAL_SLICE_SPEC.md
6. docs/UI_ACCEPTANCE_CRITERIA.md

During the temporary planning-update stage, also read:

6. `PROJECT_PLAN_ADDENDUM.md`

If any referenced document is missing, stop and report it before implementation.

---

## 3. Source-of-truth priority

When instructions conflict, use this priority order:

1. Explicit instruction from the user in the current Claude Code session, provided it does not weaken security, privacy, data integrity or other non-negotiable safeguards
2. `SECURITY_STANDARDS.md`
3. `PROJECT_PLAN.md`
4. `DEVELOPMENT_STANDARDS.md`
5. `DESIGN.md`
6. `docs/VERTICAL_SLICE_SPEC.md`
7. `docs/UI_ACCEPTANCE_CRITERIA.md`
8. Relevant installed skills
9. Existing implementation patterns

Do not silently resolve meaningful conflicts.

Explain the conflict, recommend the strongest interpretation and wait for clarification when the decision could materially affect scope, architecture, data or product behaviour.

Project-specific documentation takes precedence over generic skill examples.

---

## 4. Installed project skills

The repository currently includes:

- `frontend-design`
- `ui-ux-pro-max`
- `shadcn`

For work involving UI or UX, use all relevant installed skills.

Expected sequence:

1. Use `frontend-design` to establish the visual and experiential direction.
2. Use `ui-ux-pro-max` to review hierarchy, usability, interaction and accessibility.
3. Use `shadcn` for implementation primitives where appropriate.
4. Follow `DESIGN.md` instead of copying default shadcn examples.

Do not treat shadcn as the product's design identity.

Do not create or assume additional custom skills unless the user explicitly approves them.

---

## 5. Critical thinking

Do not optimise for agreeing with the user.

Optimise for building the strongest possible product.

You must:

- challenge weak assumptions
- identify unnecessary complexity
- recommend simpler approaches where appropriate
- point out contradictions
- identify missing product decisions
- identify missing technical decisions
- explain trade-offs
- distinguish required scope from attractive future scope
- flag when an idea is likely to create poor UX, technical debt or false certainty

Disagreement is valuable when supported by clear reasoning.

Do not be adversarial for its own sake.

---

## 6. Implementation workflow

Before implementing any significant feature:

1. Read the relevant project documentation.
2. Identify which installed skills apply.
3. Restate the user objective.
4. Explain the proposed approach.
5. Identify unresolved decisions and risks.
6. Break the work into small, testable increments.
7. Confirm acceptance criteria.
8. Implement only the approved scope.
9. Run relevant tests, linting and type checks.
10. Update documentation when behaviour or architecture changes.
11. Report what changed, what was tested and what remains unresolved.

Do not begin a major implementation when the request is still materially ambiguous.

Do not silently expand scope.

---

## 7. Initial project stage

The current priority is one polished vertical journey defined in:

- `docs/VERTICAL_SLICE_SPEC.md`

The initial build must prove:

> Conversation → analysis → research → visualisation → challenge → decision → project evolution

The first release should be narrow but convincing.

Do not broaden the build into every planned feature before the vertical slice works coherently end to end.

Deferred features include:

- mobile layouts
- founder-inspired personalities
- user-facing skills or methodology marketplace
- fully open whiteboard editing
- all discovery entry paths
- direct Claude Code execution
- team collaboration
- comprehensive billing
- broad analytics dashboards

Do not create dead buttons or decorative placeholders for deferred features.

---

## 8. UI and UX rules

For all interface work:

- follow `DESIGN.md`
- use semantic design tokens
- preserve the dark-first graphite visual system
- support light and system themes
- use `#00BF63` for action, activation and branded focus
- do not use green as a generic “important” colour
- use 8px as the default component radius
- use restrained borders and tonal layering
- use shadows only for genuinely floating surfaces
- avoid excessive cards and pills
- use an adaptive editorial conversation stream
- preserve the relationship between chat and living canvas
- keep contextual actions stable and limited
- make AI activity specific, observable and verifiable
- distinguish facts, inference, evidence and decisions
- implement keyboard and reduced-motion behaviour
- include loading, empty, success and recoverable-failure states

Do not generate:

- purple-blue AI gradients
- glowing orbs
- decorative neural networks
- generic SaaS dashboards
- oversized chat bubbles
- fake analytics
- fake progress percentages
- fake AI activity
- unsupported certainty
- card soup
- excessive glassmorphism

Every UI task must be checked against:

- `docs/UI_ACCEPTANCE_CRITERIA.md`

---

## 9. AI behaviour and trust

The runtime AI experience must:

- adapt to the user's clarity and evidence
- challenge consequential assumptions
- distinguish user-stated information from inference
- show observable work without exposing raw chain-of-thought
- make sources and limitations inspectable
- avoid inventing evidence
- avoid treating a polished document as validated truth
- preserve user control over structural decisions
- require approval for consequential connected changes
- record decision rationale and attribution

Do not display raw hidden reasoning or claim that raw chain-of-thought is available.

Use concise, user-facing rationale instead:

- evidence considered
- assumptions
- alternatives
- trade-offs
- recommendation
- what could change the conclusion

---

## 10. Data and architecture

Prefer the simplest architecture that safely supports the approved scope.

Use:

- TypeScript
- explicit schemas
- validated structured outputs
- server-side secret handling
- database-backed project memory
- auditable project events
- transactional updates for connected changes
- clear provider abstractions
- Row-Level Security for user-owned records

Do not:

- expose API keys to the browser
- allow unvalidated model output to write directly to the database
- introduce a vector database without a demonstrated need
- embed provider-specific logic throughout the application
- store raw hidden model reasoning
- hardcode secrets
- use `any` without a documented exceptional reason
- swallow errors silently

The database is the source of truth.

The language model is a reasoning engine, not the project memory.

---

## 11. Code quality

Always:

- use strict TypeScript
- prefer clear and explicit types
- keep components focused
- prefer composition over oversized components
- isolate side effects
- centralise repeated logic
- handle loading, empty and failure states
- use accessible semantic controls
- write or update tests
- keep documentation aligned with implementation

Avoid:

- oversized files
- duplicated business logic
- deeply nested component trees
- unexplained TODOs
- premature abstractions
- unnecessary dependencies
- speculative infrastructure
- broad refactors unrelated to the task

---

## 12. Testing expectations

Use appropriate combinations of:

- type checking
- linting
- unit tests
- component tests
- accessibility checks
- Playwright end-to-end tests
- visual regression tests for core workspace states

Before marking a task complete, report:

- commands run
- tests passed
- tests not run
- known limitations
- any remaining risks

Never claim testing was completed when it was not.

---

## 13. Documentation

Update relevant documentation whenever:

- architecture changes
- product behaviour changes
- database models change
- AI orchestration changes
- design conventions change
- scope changes
- a major decision is approved

Do not duplicate the same rule across many files unless the duplication is deliberate and maintainable.

Prefer one canonical source of truth and reference it elsewhere.

---

## 14. Git and change safety

When changing the repository:

- keep changes scoped
- preserve existing work
- inspect files before replacing them
- avoid destructive commands unless explicitly approved
- do not overwrite project documents without showing the proposed merge
- explain migrations or irreversible changes before applying them
- keep unrelated formatting changes out of feature commits

During review and architecture work, create drafts under:

```text
docs/review/
```

unless the user explicitly asks for direct edits.

---

## 15. Stop conditions

Stop and ask for clarification when:

- project documents materially conflict
- a major product decision is unresolved
- the requested change would expand scope substantially
- a data migration may be destructive
- security or privacy implications are unclear
- acceptance criteria cannot be determined
- required files or credentials are missing
- implementation would depend on fabricated data or fake integrations

Do not use uncertainty as an excuse to avoid reasonable progress.

Make the strongest safe recommendation, explain it clearly and identify the exact decision needed.

---

## 16. Current review instruction

Until the repository review and project-plan merge are approved:

- do not write application code
- do not overwrite `PROJECT_PLAN.md`
- do not begin Phase 1
- review the repository critically
- propose the plan merge
- propose the architecture
- propose the vertical-slice task breakdown
- wait for approval
