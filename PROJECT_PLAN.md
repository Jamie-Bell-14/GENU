# Product Discovery Platform — Build Plan

## Development Standards

This project must be implemented in accordance with:

- SECURITY_STANDARDS.md
- DEVELOPMENT_STANDARDS.md
- DESIGN.md
- CLAUDE.md
- Installed Claude Code project skills

These documents define how the product should be designed and engineered.

PROJECT_PLAN.md defines what should be built.

When documents conflict, the source-of-truth priority in CLAUDE.md §3 governs.

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

---

## 1. Product vision

Build an AI-guided product discovery platform that helps a user move from:

- an industry they are interested in
- a problem they have noticed
- a partially formed product idea
- a technology they want to apply
- or no clear idea at all

to a structured, challenged and implementation-ready product plan.

The platform must not behave like a static questionnaire.

It should maintain a growing model of the project and dynamically decide:

1. What is already known
2. What remains unclear
3. Which assumptions are weak
4. Which question would create the most useful clarity next
5. When the project is sufficiently defined to move into planning
6. When the user should be challenged rather than simply encouraged

The initial product ends at an exportable Claude Code build package.

## Product Experience North Star

The product should feel like an Intelligent Product Lab:

A technically precise but creatively responsive environment where conversation drives an evolving visual model of the user's research, assumptions, decisions and product plan.

The central product loop is:

Conversation → analysis → research → visualisation → challenge → decision → project evolution

The project—not the AI personality—is the primary focus.

The interface must not resemble a generic chatbot, generic AI SaaS dashboard, form-based business-plan generator or decorative developer terminal.

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

The approved architecture and task breakdown are in:

- docs/ARCHITECTURE.md
- docs/VERTICAL_SLICE_TASKS.md

Although functionality is intentionally narrow, the brand system and general UI/UX language must be implemented properly from the beginning.

The first release should feel like a narrow version of the real product, not a broadly functional prototype with temporary styling.

---

# 2. Longer-term MVP objective (post-slice roadmap)

> Roadmap section. The near-term commitment is the Initial Build Strategy above; this section describes the fuller MVP that follows a validated vertical slice.

The MVP should allow a user to:

1. Create an account
2. Start a new project
3. Select their starting position
4. Have a dynamic AI discovery conversation
5. See a live structured project model update
6. Review assumptions, risks and unanswered questions
7. Generate a product definition
8. Generate an MVP scope
9. Generate a technical implementation plan
10. Export the plan for Claude Code

The MVP does not need to execute Claude Code directly.

Direct coding-agent orchestration can be introduced after the planning experience has been validated.

---

# 3. Initial user entry paths (post-slice roadmap)

> Roadmap section. The vertical slice implements the problem-first path only; the remaining paths are deferred scope.

When creating a project, ask:

"What are you starting with?"

Options:

- I have a problem I want to solve
- I have a product idea
- I am interested in a particular market
- I have a technology I want to use
- I want to discover an opportunity
- I have an existing project I want to improve

Each path should create a different initial AI strategy.

## Problem-first

Goal:

- Understand the problem
- Identify affected customers
- Understand current alternatives
- Measure severity and frequency
- Explore possible solutions

## Product-first

Goal:

- Understand the proposed product
- Identify the underlying problem
- Identify the intended customer
- Challenge whether the product solves a meaningful need
- Separate features from actual value

## Market-first

Goal:

- Understand the market
- Identify underserved customers
- Explore workflows, inefficiencies and changes
- Generate and rank potential problems
- Select one opportunity for deeper exploration

## Technology-first

Goal:

- Understand the technology
- Identify where it offers a genuine advantage
- Avoid forcing the technology into weak use cases
- Generate possible applications
- Rank applications by usefulness and feasibility

## Opportunity discovery

Goal:

- Learn the user's experience, interests and capabilities
- Explore suitable markets
- Surface potential customer problems
- Compare opportunities
- Select a problem worth investigating

## Existing project

Goal:

- Understand the existing product
- Import or capture current functionality
- Identify strategic, user-experience and technical problems
- Propose improvements
- Update the project definition

---

# 4. Core product model

Each project should maintain a structured project model.

The implemented schema is defined in docs/ARCHITECTURE.md §6. It uses a flexible
`project_fields` design (area + key + value + state) that grows toward the full
profile below without migration churn.

Profile areas (grown incrementally; the slice implements problem, customer,
value proposition and MVP scope):

- summary, vision, market, industry
- customer_segments, primary_customer, user_roles
- problem_statement, problem_evidence, existing_alternatives
- proposed_solution, value_proposition, differentiation
- assumptions, risks, constraints
- business_model, pricing_hypotheses, acquisition_channels
- success_metrics, compliance_requirements, technical_preferences
- current_stage

Each field carries:

- value
- origin — `user_stated | ai_inferred | researched`
- support — `unexplored | hypothesis | some_evidence | credible | strongly_evidenced | contradicted`
- evidence links
- source message references
- last_updated

Confidence is qualitative. Numeric confidence scores are not stored or displayed
anywhere: model-emitted numeric confidence is not calibrated and manufactures
false precision (see DESIGN.md §2.3 and §12).

Example:

```json
{
  "area": "customer",
  "key": "primary_customer",
  "value": "Independent letting agents managing fewer than 500 properties",
  "origin": "ai_inferred",
  "support": "hypothesis",
  "evidence": ["User stated small agencies struggle to chase landlords"],
  "sourceMessageIds": ["message_123"]
}
```

---

# 5. Dynamic discovery engine (post-slice roadmap)

> Roadmap section. The slice implements the subset of this loop that the
> problem-first journey exercises; enums remain extensible.

Do not implement the conversation as a hardcoded sequence of questions.

Implement a discovery loop.

For every user response:

1. Save the original message
2. Extract new project information
3. Update relevant project-model fields
4. Identify contradictions
5. Reassess qualitative support states
6. Identify critical knowledge gaps
7. Rank possible next actions
8. Select the highest-value next question
9. Generate the next response
10. Save the reasoning metadata, but do not expose private model reasoning

The engine should choose among these action types:

- ask_for_detail
- clarify_ambiguity
- challenge_assumption
- identify_customer
- identify_problem
- request_evidence
- compare_alternatives
- explore_solution
- define_scope
- examine_risk
- examine_commercial_model
- examine_compliance
- summarise_progress
- propose_options
- move_to_next_stage

The next question should optimise for information gain, not questionnaire completion.

---

# 6. Discovery state machine (post-slice roadmap)

Use flexible stages rather than a rigid wizard.

Stages:

1. Orientation
2. Problem discovery
3. Customer definition
4. Evidence and validation
5. Solution exploration
6. Product definition
7. Commercial definition
8. MVP scoping
9. Technical planning
10. Export readiness

A project may move backwards when:

- an assumption is invalidated
- the customer changes
- the problem changes
- the proposed solution does not fit the problem
- new evidence creates a contradiction

The user must be able to see the current stage without being forced through a linear process.

---

# 7. AI response behaviour

The AI should:

- Ask one primary question at a time
- Explain briefly why an important question matters
- Avoid generic praise
- Distinguish facts from assumptions
- Challenge weak logic respectfully
- Detect when the user is describing a feature rather than a problem
- Avoid inventing customer evidence
- State when external research is needed
- Offer options when the user is stuck
- Summarise periodically
- Allow the user to edit the structured project model directly

The AI should not:

- Say every idea is excellent
- immediately generate a full product
- ask questions already answered
- repeatedly ask generic questions
- treat inferred information as confirmed
- fabricate market research
- allow unresolved contradictions to disappear into the plan

---

# 8. User interface

The workspace layout, planning navigation, adaptive editorial conversation and
living canvas are defined in DESIGN.md §3, which is the canonical description of
the interface. Do not reintroduce the earlier three-panel "project model sidebar"
layout.

Mobile layouts are deferred scope. When they arrive: conversation is primary,
the project model opens as a separate sheet or tab, and three columns are never
squeezed onto a small screen.

## Primary screens (slice subset marked ✦)

1. Marketing landing page
2. ✦ Sign-up and login (minimal)
3. ✦ Project list (plain; dashboard design deferred)
4. New-project entry-path selection (slice: problem-first opening only)
5. ✦ Discovery workspace
6. ✦ Project-model review (canvas + documents)
7. MVP scope review
8. Build-plan preview
9. Export screen
10. Account settings (slice: appearance settings only)

---

# 9. UX principles

The experience should feel:

- calm
- intelligent
- serious
- exploratory
- collaborative
- visually distinctive
- less like a chatbot
- more like a product strategy workspace

The canonical anti-pattern list is DESIGN.md §21. Every UI task is checked
against docs/UI_ACCEPTANCE_CRITERIA.md.

The product should have:

- a limited colour system
- a deliberate typography hierarchy
- strong information density
- visible project progression
- restrained motion
- consistent spacing
- accessible contrast
- full keyboard navigation
- clear focus and hover states

---

# 10. Technical stack

Frontend:
- Next.js (App Router)
- TypeScript (strict)
- Tailwind CSS v4
- shadcn/ui primitives (re-themed to semantic tokens)
- React Hook Form (when forms need it)
- Zod
- TanStack Query

Backend:
- Next.js route handlers (SSE) for streaming turns and research; Server Actions
  only for small non-streaming mutations, treated as public endpoints
- Supabase Postgres
- Supabase Auth (email + password, verified email, for the slice)
- Row-Level Security on every table
- Supabase Storage for future attachments (uploads disabled until
  SECURITY_STANDARDS §12 controls exist)

AI:
- Anthropic API (server-side only)
- Structured tool calls with Zod-validated inputs
- Versioned prompts; model usage and failures logged without message bodies
- Never rely on free-form model output for database writes

Testing:
- Vitest, React Testing Library, Playwright, axe accessibility checks,
  two-user RLS isolation suite in CI

Deployment:
- Vercel + Supabase (separate dev and production projects)

Monitoring:
- Deferred for the slice: structured server logs with redaction only.
  Sentry/PostHog may be added post-slice subject to SECURITY_STANDARDS §13/§15
  (no private project content to third parties).

---

# 11. AI operation boundaries

Do not use one giant prompt to manage the entire conversation, and never let
model output write directly to the database.

The conversation engine sits behind the `DiscoveryEngine` interface
(docs/ARCHITECTURE.md §8).

**Slice implementation (approved):** one streaming Claude call per turn using
tool-use (`update_project_model`, `propose_connected_change`, `start_research`,
`suggest_checkpoint`). Application code validates every tool input, authorises
it against the project, applies it through services and emits observable
activity events. This preserves the operation boundaries below as *logical*
boundaries while keeping turn latency and cost acceptable.

The logical operations remain, and may become separate model calls post-slice
if extraction quality demands it — the interface makes that swap invisible:

## Operation A: Extract project updates

Input: latest user message, relevant recent conversation, current project model.
Output: proposed field updates, supporting evidence, origin, support-state
changes, contradictions.

## Operation B: Evaluate project state

Input: full structured project model.
Output: important gaps, weak assumptions, contradictions, current stage,
possible next actions, ranked recommendation.

## Operation C: Generate conversational response

Input: user message, project updates, state evaluation, selected next action,
tone and behavioural rules.
Output: short reflection, optional challenge or observation, one primary next
question, optional suggested answers.

## Operation D: Generate artefacts (post-slice)

Generate independently: opportunity summary, problem brief, customer profile,
value proposition, assumptions register, risk register, MVP scope, user
journeys, functional requirements, non-functional requirements, data model,
technical architecture, implementation backlog, Claude Code handoff package.

Every generated artefact must reference the current project model rather than
only the conversation transcript.

---

# 12. Structured AI output

Use Zod schemas for every model response.

Never write directly to the database from unvalidated AI output.

Example:

```ts
const ProjectUpdateSchema = z.object({
  updates: z.array(
    z.object({
      area: z.enum(["problem", "customer", "value_proposition", "mvp_scope"]),
      key: z.string().max(64),
      value: z.unknown(),
      origin: z.enum(["user_stated", "ai_inferred", "researched"]),
      support: z.enum([
        "unexplored",
        "hypothesis",
        "some_evidence",
        "credible",
        "strongly_evidenced",
        "contradicted"
      ]),
      evidence: z.array(z.string().max(500)).max(10),
      sourceMessageIds: z.array(z.string()).max(20)
    })
  ).max(20),
  contradictions: z.array(
    z.object({
      description: z.string().max(500),
      relatedFields: z.array(z.string()).max(10),
      severity: z.enum(["low", "medium", "high"])
    })
  ).max(10)
}).strict()
```

Invalid responses should be retried once with schema-error feedback.

If the second attempt fails:
- preserve the user message
- show a recoverable error
- do not corrupt the project model

---

# 13. Claude Code export (post-slice roadmap)

The exported build package should contain:

```text
/project-export
  README.md
  PRODUCT_VISION.md
  PROBLEM_AND_CUSTOMER.md
  ASSUMPTIONS.md
  MVP_SCOPE.md
  USER_FLOWS.md
  REQUIREMENTS.md
  ARCHITECTURE.md
  DATA_MODEL.md
  SECURITY_AND_PRIVACY.md
  TESTING_STRATEGY.md
  IMPLEMENTATION_PLAN.md
  CLAUDE.md
  tasks/
    001-project-foundation.md
    002-authentication.md
    003-database-schema.md
    004-core-workspace.md
```

Each task must contain:

- objective
- context
- dependencies
- files likely to change
- functional requirements
- acceptance criteria
- edge cases
- test requirements
- out-of-scope items
- completion checklist

The generated CLAUDE.md should tell Claude Code:

- read the project documentation before coding
- work on one task at a time
- create a branch for each task
- do not silently change scope
- ask when documentation conflicts
- run type-checking, linting and tests
- update documentation when decisions change
- stop when acceptance criteria are not clear

---

# 14. Security and privacy

All security requirements are defined in SECURITY_STANDARDS.md, which is
mandatory for every task. The security review of the approved architecture is
in docs/SECURITY_REVIEW.md.

Product-specific rules beyond the standards:

- external web research does not ship until sources can be clearly attributed
  and the SECURITY_STANDARDS §11.3 controls exist; until then research is
  mocked and every demonstration datum is schema-flagged and visibly labelled
- AI-generated content is always visually distinguishable from user-stated
  information and sourced evidence
- observable AI activity derives only from real application events, never from
  model narration

---

# 15. Development phases

## Phase 0 — Repository Review, Architecture and Design Foundation ✔ complete

Completed by the approved review (2026-07). Outcomes: docs/ARCHITECTURE.md,
docs/VERTICAL_SLICE_TASKS.md, docs/SECURITY_REVIEW.md, and this merged plan.

## Phase 1 — Foundation

Build:

- Next.js project, tooling, CI
- Supabase integration and migrations
- authentication (email + password, verified email)
- projects table with tested RLS
- design tokens and appearance infrastructure
- re-themed base primitives

Completion criteria:

- user can register, log in and create a project
- users cannot access each other's projects (proven by the CI RLS suite)
- tokens power dark, light, density, text-size and reduced-motion
- CI passes

Tasks T1–T4 in docs/VERTICAL_SLICE_TASKS.md.

## Phase 2 — Design System and Workspace Shell

Build:

- dark-first application shell with stable planning navigation
- resizable conversation/canvas workspace with focus modes
- adaptive editorial conversation primitives
- canvas object primitives and zoned living canvas
- contextual action row and adaptive composer
- observable-activity system with stop/steer
- loading, empty, success and recoverable-failure patterns

Completion criteria:

- UI acceptance checklist passes
- no hardcoded theme colours in components
- keyboard navigation works for the shell
- reduced motion produces an understandable experience
- the workspace does not resemble a generic chatbot

Tasks T5–T8 in docs/VERTICAL_SLICE_TASKS.md.

## Phase 3 — First Complete Vertical Journey

Implement the journey in docs/VERTICAL_SLICE_SPEC.md.

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

Tasks T9–T15 in docs/VERTICAL_SLICE_TASKS.md.

## Post-slice roadmap phases

Sequenced after the vertical slice is validated; scope revisited at that point.

- **Dynamic discovery breadth** — remaining entry paths, full action-type set,
  stage progression engine (old Phase 3–4 scope)
- **Project intelligence** — full assumptions register, contradiction
  detection, risk register, editable project model breadth
- **Plan generation** — product brief, MVP scope, requirements, architecture
  proposal, implementation backlog, generated CLAUDE.md
- **Export** — Markdown export, ZIP export, copy-for-Claude-Code, regenerated
  artefacts after project changes; deletion and export of user data ship here
  at the latest (production gate)
- **Quality breadth** — responsive design, full accessibility review, visual
  regression tooling, token usage monitoring, onboarding polish

---

## Deferred Until After Vertical-Slice Validation

Canonical deferred-scope list. Referenced by CLAUDE.md, DESIGN.md and
docs/VERTICAL_SLICE_SPEC.md.

Do not implement during the initial vertical slice:

- mobile layouts
- founder-inspired guidance personalities
- user-facing skills or methodology marketplace
- fully open whiteboard editing, including free movement of canvas objects
- all discovery entry paths beyond problem-first
- real external web research (mocked, labelled research only)
- file uploads
- direct Claude Code execution
- team collaboration
- comprehensive billing
- full commercial-planning workflow
- full technical-planning workflow
- generic analytics dashboard
- third-party analytics/monitoring integrations

Do not add dead buttons or decorative placeholders for deferred features.

---

# 16. Implementation order

The implementation order is the task sequence T1–T15 in
docs/VERTICAL_SLICE_TASKS.md.

After each task:

- run tests
- update documentation
- commit the completed work
- confirm acceptance criteria
- do not begin the next task if the current one is broken

### UI/UX acceptance for every UI task

Every UI task must pass docs/UI_ACCEPTANCE_CRITERIA.md (canonical checklist)
before it is complete.

---

# 17. Phase 0 record

Phase 0 was defined by CLAUDE_REVIEW_PROMPT.md and completed by the approved
review of 2026-07 (docs/review/ drafts, since promoted into docs/). Decisions
taken at approval:

1. Confidence is qualitative; no numeric confidence scores (§4, §12)
2. Slice engine is one streaming tool-use call behind `DiscoveryEngine` (§11)
3. Free canvas-object movement is deferred scope
4. Slice authentication is minimal Supabase email + password
5. References to not-yet-existing skills were removed from
   DEVELOPMENT_STANDARDS.md
6. CLAUDE.md §3 is the canonical source-of-truth order
7. The slice ships on the system Helvetica stack; licensed display typography
   (Helvetica Now + rounded companion) is a later decision

Incident-response owner (SECURITY_STANDARDS §20): **Jamie Bell**
(jamie.bell@zerodeposit.com), recorded 2026-07-28.

Still open (owner: Jamie): per-turn/monthly AI cost budget numbers
(SECURITY_STANDARDS §17), needed by task T9.
