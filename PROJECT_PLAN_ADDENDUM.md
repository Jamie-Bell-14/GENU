# Project Plan Addendum — Initial Experience and Design Direction

Merge the following sections into `PROJECT_PLAN.md`.

Do not overwrite existing requirements without first identifying conflicts.

---

## A. Product experience north star

Add near the product vision:

```md
## Product Experience North Star

The product should feel like an Intelligent Product Lab:

A technically precise but creatively responsive environment where conversation drives an evolving visual model of the user's research, assumptions, decisions and product plan.

The central product loop is:

Conversation → analysis → research → visualisation → challenge → decision → project evolution

The project—not the AI personality—is the primary focus.

The interface must not resemble a generic chatbot, generic AI SaaS dashboard, form-based business-plan generator or decorative developer terminal.
```

---

## B. Design source of truth

Add after the Development Standards section:

```md
## Design Source of Truth

All interface work must follow:

- DESIGN.md
- DEVELOPMENT_STANDARDS.md
- docs/UI_ACCEPTANCE_CRITERIA.md
- Relevant installed Claude Code skills

For UI and UX work, use:

- frontend-design
- ui-ux-pro-max
- shadcn

DESIGN.md defines this product's identity and takes precedence over generic examples supplied by any skill or component library.
```

---

## C. Replace the initial broad MVP emphasis

Use this as the initial build strategy:

```md
## Initial Build Strategy

The first build will not attempt to implement every planned discovery path or planning capability.

It will deliver one polished vertical journey that proves the complete interaction loop:

1. User starts with a problem
2. AI clarifies and challenges it
3. User triggers research
4. Observable AI activity shows real work
5. Research appears as an evidence-led visual
6. Evidence enters the project model
7. A target customer or problem direction is refined
8. AI proposes one connected change across project areas
9. User reviews and approves the connected change
10. Living documents update visibly
11. Decision history records evidence, reasoning and attribution
12. AI suggests a milestone checkpoint

The vertical journey is specified in:

- docs/VERTICAL_SLICE_SPEC.md

Although functionality is intentionally narrow, the brand system and general UI/UX language must be implemented properly from the beginning.

The first release should feel like a narrow version of the real product, not a broadly functional prototype with temporary styling.
```

---

## D. Add a Phase 0

Insert before implementation phases:

```md
## Phase 0 — Repository Review, Architecture and Design Foundation

Claude Code must not write application code until this phase is reviewed and approved.

Tasks:

1. Read:
   - PROJECT_PLAN.md
   - DEVELOPMENT_STANDARDS.md
   - DESIGN.md
   - docs/VERTICAL_SLICE_SPEC.md
   - docs/UI_ACCEPTANCE_CRITERIA.md
   - CLAUDE.md
   - installed project skills

2. Identify:
   - contradictions
   - unrealistic requirements
   - unnecessary complexity
   - missing technical decisions
   - missing product decisions
   - areas where the vertical slice conflicts with the broader roadmap

3. Propose:
   - repository structure
   - component architecture
   - state architecture
   - database schema
   - AI orchestration boundary
   - research-provider boundary
   - change-proposal model
   - decision-history model
   - document-version model
   - design-token integration
   - test strategy

4. Break the first vertical slice into small tasks with:
   - objective
   - dependencies
   - files likely to change
   - acceptance criteria
   - edge cases
   - tests
   - out-of-scope items

5. Present the proposal for review.

Completion criteria:

- no unresolved architecture conflict remains hidden
- the design-token approach is agreed
- the vertical-slice state model is agreed
- mock and real service boundaries are explicit
- implementation tasks are small and sequenced
- no application code has been written
```

---

## E. Replace or refine the static prototype phase

Use:

```md
## Phase 1 — Design System and Workspace Shell

Build:

- semantic dark and light tokens
- dark-first application shell
- theme switching
- density controls
- reduced-motion control
- text-size control
- stable planning navigation
- resizable conversation/canvas workspace
- adaptive editorial conversation primitives
- canvas object primitives
- contextual action row
- adaptive composer
- loading, empty, success and recoverable-failure patterns

Use:

- DESIGN.md
- styles/design-tokens.css
- frontend-design skill
- ui-ux-pro-max skill
- shadcn skill for implementation primitives

Completion criteria:

- UI acceptance checklist passes
- dark and light themes use semantic tokens
- no hardcoded theme colours in components
- keyboard navigation works for the shell
- reduced motion produces an understandable experience
- the workspace does not resemble a generic chatbot
```

---

## F. Add the vertical-slice implementation phase

```md
## Phase 2 — First Complete Vertical Journey

Implement the journey in:

- docs/VERTICAL_SLICE_SPEC.md

Priorities:

1. Coherent end-to-end interaction
2. Trust and traceability
3. Visible project evolution
4. Strong UI/UX execution
5. Replaceable service boundaries

Do not broaden scope until the complete journey works.

Completion criteria:

- user can complete the full scenario
- observable AI activity reflects real or explicitly mocked operations
- claims distinguish source, inference and assumption
- research can be steered
- connected changes require approval
- approved changes update all affected areas
- decision history records reasoning and attribution
- milestone checkpoint is suggested rather than forced
- all important states have loading, failure and undo behaviour
```

---

## G. Add explicit deferred scope

```md
## Deferred Until After Vertical-Slice Validation

Do not implement during the initial vertical slice:

- mobile layouts
- founder-inspired guidance personalities
- user-facing skills or methodology marketplace
- fully open whiteboard editing
- all discovery entry paths
- direct Claude Code execution
- team collaboration
- comprehensive billing
- full commercial-planning workflow
- full technical-planning workflow
- generic analytics dashboard

Do not add dead buttons or decorative placeholders for deferred features.
```

---

## H. Add UI/UX task acceptance criteria

Append to every UI task:

```md
### UI/UX Acceptance

- [ ] Relevant design skills were used
- [ ] DESIGN.md was followed
- [ ] User objective and information hierarchy are explicit
- [ ] Dark and light themes were reviewed
- [ ] Semantic tokens are used
- [ ] 8px default radius is respected
- [ ] Colour communicates meaning rather than decoration
- [ ] Keyboard interaction works
- [ ] Focus states are visible
- [ ] Reduced-motion behaviour exists
- [ ] Loading, empty, success and failure states exist
- [ ] No generic chatbot or generic dashboard styling
- [ ] No unsupported certainty is introduced
- [ ] Changes and AI activity remain traceable
```
