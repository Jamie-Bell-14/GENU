# Product Discovery Platform — Initial Build Plan

## Development Standards

This project must be implemented in accordance with:

- DEVELOPMENT_STANDARDS.md
- DESIGN.md
- CLAUDE.md
- Installed Claude Code project skills

These documents define how the product should be designed and engineered.

PROJECT_PLAN.md defines what should be built.



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

---

# 2. MVP objective

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

# 3. Initial user entry paths

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

Suggested initial schema:

Project
- id
- user_id
- name
- status
- entry_path
- created_at
- updated_at

ProjectProfile
- summary
- vision
- market
- industry
- customer_segments
- primary_customer
- user_roles
- problem_statement
- problem_evidence
- existing_alternatives
- proposed_solution
- value_proposition
- differentiation
- assumptions
- risks
- constraints
- business_model
- pricing_hypotheses
- acquisition_channels
- success_metrics
- compliance_requirements
- technical_preferences
- current_stage

Each field should contain:

- value
- confidence_score
- evidence
- source_message_ids
- last_updated
- status

Possible statuses:

- unknown
- inferred
- user_confirmed
- researched
- challenged
- invalidated

Example:

{
  "field": "primary_customer",
  "value": "Independent letting agents managing fewer than 500 properties",
  "confidence": 0.72,
  "status": "inferred",
  "evidence": [
    "User stated small agencies struggle to chase landlords"
  ],
  "sourceMessageIds": ["message_123"]
}

---

# 5. Dynamic discovery engine

Do not implement the conversation as a hardcoded sequence of questions.

Implement a discovery loop.

For every user response:

1. Save the original message
2. Extract new project information
3. Update relevant project-model fields
4. Identify contradictions
5. Recalculate confidence scores
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

# 6. Discovery state machine

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

## Main application layout

Use a three-panel desktop experience.

Left sidebar:
- Projects
- Current stage
- Discovery sections
- Documents
- Export

Centre panel:
- AI conversation
- Question and answer interaction
- Suggested answer prompts
- Supporting explanations
- File or link attachments later

Right panel:
- Live project model
- Confidence indicators
- Assumptions
- Risks
- Missing information
- Contradictions

On mobile:
- Conversation is primary
- Project model opens as a separate sheet or tab
- Avoid squeezing three columns onto a small screen

## Primary screens

1. Marketing landing page
2. Sign-up and login
3. Project dashboard
4. New-project entry-path selection
5. Discovery workspace
6. Project-model review
7. MVP scope review
8. Build-plan preview
9. Export screen
10. Account settings

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

Avoid:

- purple AI gradients
- glowing orbs
- excessive glassmorphism
- generic rounded cards everywhere
- large amounts of empty dashboard space
- fake analytics
- emoji icons
- unnecessary animations
- a conventional ChatGPT clone layout

Create an explicit design direction before implementing screens.

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

# 10. Suggested technical stack

Frontend:
- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui primitives
- React Hook Form
- Zod
- TanStack Query where needed

Backend:
- Next.js server actions or route handlers for MVP
- Supabase Postgres
- Supabase Auth
- Row-Level Security
- Supabase Storage for future attachments

AI:
- Anthropic API
- Structured tool calls or validated JSON responses
- Separate prompts for extraction, gap analysis and response generation
- Store prompt versions
- Log model usage and failures
- Never rely on free-form model output for database writes

Testing:
- Vitest
- React Testing Library
- Playwright
- axe accessibility checks

Deployment:
- Vercel
- Supabase

Monitoring:
- Sentry
- PostHog or a privacy-conscious equivalent

---

# 11. AI architecture

Do not use one giant prompt to manage the entire conversation.

Create separate AI operations.

## Operation A: Extract project updates

Input:
- latest user message
- relevant recent conversation
- current project model

Output:
- proposed field updates
- supporting evidence
- inferred or confirmed status
- confidence changes
- contradictions

## Operation B: Evaluate project state

Input:
- full structured project model

Output:
- important gaps
- weak assumptions
- contradictions
- current stage
- possible next actions
- ranked recommendation

## Operation C: Generate conversational response

Input:
- user message
- project updates
- state evaluation
- selected next action
- tone and behavioural rules

Output:
- short reflection
- optional challenge or observation
- one primary next question
- optional suggested answers

## Operation D: Generate artefacts

Generate independently:

- opportunity summary
- problem brief
- customer profile
- value proposition
- assumptions register
- risk register
- MVP scope
- user journeys
- functional requirements
- non-functional requirements
- data model
- technical architecture
- implementation backlog
- Claude Code handoff package

Every generated artefact must reference the current project model rather than only the conversation transcript.

---

# 12. Structured AI output

Use Zod schemas for every model response.

Never write directly to the database from unvalidated AI output.

Example:

const ProjectUpdateSchema = z.object({
  updates: z.array(
    z.object({
      field: z.string(),
      value: z.unknown(),
      confidence: z.number().min(0).max(1),
      status: z.enum([
        "inferred",
        "user_confirmed",
        "challenged",
        "invalidated"
      ]),
      evidence: z.array(z.string()),
      sourceMessageIds: z.array(z.string())
    })
  ),
  contradictions: z.array(
    z.object({
      description: z.string(),
      relatedFields: z.array(z.string()),
      severity: z.enum(["low", "medium", "high"])
    })
  )
})

Invalid responses should be retried once with schema-error feedback.

If the second attempt fails:
- preserve the user message
- show a recoverable error
- do not corrupt the project model

---

# 13. Claude Code export

The exported build package should contain:

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

Implement from the beginning:

- Row-Level Security on all user-owned records
- encrypted transport
- no API keys exposed to the browser
- server-side AI requests
- input length limits
- rate limiting
- output validation
- audit logging for project-model changes
- deletion of projects and associated data
- export of user data
- clear AI-generated-content indicators
- protection against prompt injection in imported content

Do not add external web research to the initial MVP unless sources can be clearly attributed.

---

# 15. MVP development phases

## Phase 1: Foundation

Build:

- Next.js project
- Supabase integration
- authentication
- database migrations
- project creation
- application shell
- basic design tokens
- testing setup

Completion criteria:

- user can register
- user can log in
- user can create a project
- users cannot access each other's projects
- CI passes

## Phase 2: Static discovery prototype

Build:

- entry-path selection
- conversation interface
- message persistence
- initial project-model panel
- mocked AI responses

Purpose:

Validate the UX before introducing model complexity.

## Phase 3: Dynamic discovery engine

Build:

- Anthropic API integration
- extraction operation
- project-state evaluation
- next-question selection
- response generation
- Zod validation
- error recovery
- confidence updates

## Phase 4: Project intelligence

Build:

- assumptions register
- contradiction detection
- risk register
- missing-information panel
- editable project model
- change history
- stage progression

## Phase 5: Plan generation

Build:

- product brief
- MVP scope
- requirements
- architecture proposal
- implementation backlog
- generated CLAUDE.md

## Phase 6: Export

Build:

- Markdown export
- ZIP export
- copy-for-Claude-Code
- regenerated artefacts after project changes

## Phase 7: Quality

Complete:

- responsive design
- keyboard navigation
- accessibility review
- visual regression tests
- security review
- loading and empty states
- failure and retry states
- token usage monitoring
- onboarding polish

---

# 16. Initial implementation order

Do not implement everything simultaneously.

Work in this order:

1. Repository and tooling
2. Design direction and design tokens
3. Authentication
4. Database and RLS
5. Project dashboard
6. New-project flow
7. Static discovery workspace
8. Project-model panel
9. Message persistence
10. AI extraction
11. State evaluation
12. Dynamic question generation
13. Assumptions and contradictions
14. Artefact generation
15. Export
16. Testing and accessibility
17. Deployment

After each item:

- run tests
- update documentation
- commit the completed work
- confirm acceptance criteria
- do not begin the next item if the current one is broken

---

# 17. First Claude Code instruction

Read this entire plan before making changes.

First:

1. Analyse the requirements
2. Identify unresolved technical decisions
3. Propose the repository structure
4. Propose the database schema
5. Propose the design direction
6. Break Phase 1 into small implementation tasks
7. Do not write application code yet

Return the proposal for review before implementation begins.
