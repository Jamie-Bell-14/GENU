# Development Standards

These standards apply to every implementation task in this project.

Claude Code should use the project's installed skills, project documentation and design standards before making implementation decisions.

The goal is to create a product that feels intentionally designed, technically robust and strategically thoughtful—not a generic AI application.

---

# Source of Truth

Implementation should always follow this priority order:

1. PROJECT_PLAN.md
2. DEVELOPMENT_STANDARDS.md
3. DESIGN.md
4. CLAUDE.md
5. Relevant project skills

If two documents appear to conflict:

* stop implementation
* explain the conflict
* ask for clarification

Never silently choose one interpretation.

---

## Security

All engineering work must follow SECURITY_STANDARDS.md.

Security must be considered during planning, implementation, testing and review—not added as a final release step.

Every task must identify:

- data accessed or modified
- authentication requirements
- authorisation requirements
- trust boundaries
- untrusted inputs
- RLS implications
- secret-handling requirements
- abuse and cost risks
- audit requirements
- required security tests

A task is not complete while a material security question remains unresolved.


---

# Required Development Workflow

Before implementing any significant feature:

1. Read the relevant section of PROJECT_PLAN.md.
2. Identify which project skills are applicable.
3. Apply those skills before generating code.
4. Explain the proposed implementation approach.
5. Implement in small, testable increments.
6. Run linting and tests.
7. Update documentation where appropriate.
8. Commit only once acceptance criteria are met.

Never skip these steps.

---

# Skill Usage

Claude Code should automatically determine the appropriate skills for each task.

When appropriate, explicitly use the relevant project skills before implementation.

## UI & UX

For any work involving:

* pages
* layouts
* components
* navigation
* onboarding
* forms
* typography
* colour
* spacing
* interactions
* responsiveness
* accessibility
* visual hierarchy
* dashboards

Use:

* frontend-design
* ui-ux-pro-max
* shadcn

Expected workflow:

1. Understand the user goal.
2. Apply frontend-design to determine the overall visual direction.
3. Apply ui-ux-pro-max to validate UX, hierarchy and accessibility.
4. Use shadcn only to implement components.
5. Follow DESIGN.md rather than default shadcn examples.
6. Present the design approach before implementation where changes are significant.

Never generate generic AI SaaS interfaces.

Never default to:

* glowing gradients
* excessive glassmorphism
* oversized cards
* chatbot clones
* unnecessary animations
* dashboard filler
* placeholder analytics

Every interface should feel deliberate.

---

## Product Discovery

For anything involving:

* conversation flow
* questioning
* discovery engine
* customer understanding
* assumptions
* project modelling
* confidence scoring
* contradictions

Use:

* discovery-engine
* founder-philosophy

Optimise for:

* clarity
* information gain
* structured thinking
* evidence collection

Never optimise simply for conversation length.

---

## Product Strategy

For:

* MVP scope
* product definition
* feature prioritisation
* value proposition
* business model
* roadmap
* customer journey

Use:

* founder-philosophy

Challenge assumptions.

Distinguish evidence from opinion.

Never treat user ideas as automatically correct.

---

## Database

For:

* schema
* migrations
* Supabase
* Row Level Security
* data integrity
* storage

Use:

* supabase-standards

Prioritise:

* simplicity
* security
* auditability
* scalability

---

## React Architecture

For:

* component design
* folders
* hooks
* state management
* server actions
* API routes

Use:

* react-architecture

Prefer:

* small components
* composition
* reusable patterns
* explicit typing

Avoid:

* deeply nested components
* duplicated logic
* oversized files

---

## Code Quality

For every implementation:

Always:

* use TypeScript
* write clear types
* avoid "any"
* handle loading states
* handle empty states
* handle failure states
* implement accessibility
* update documentation
* run tests

Never:

* leave TODOs without explanation
* hardcode secrets
* silently ignore errors
* introduce unnecessary dependencies

---

# UI Acceptance Criteria

Every new screen should satisfy all of the following:

□ frontend-design applied

□ ui-ux-pro-max review completed

□ DESIGN.md followed

□ Responsive layout complete

□ Keyboard accessible

□ Accessibility reviewed

□ Loading state implemented

□ Empty state implemented

□ Error state implemented

□ Success state implemented

□ Visual hierarchy reviewed

□ Typography reviewed

□ Colour system consistent

□ Mobile behaviour reviewed

□ No generic AI SaaS styling

If any item cannot be completed, explain why before continuing.

---

# Design Principles

The application should feel:

* calm
* intelligent
* editorial
* structured
* exploratory
* premium
* focused
* trustworthy

It should not feel like:

* ChatGPT
* a template
* a startup landing page
* a generic admin dashboard
* a generated interface

The UI should communicate confidence through clarity rather than decoration.

---

# Documentation

Whenever architecture or behaviour changes:

Update the relevant documentation.

Possible documents include:

* PROJECT_PLAN.md
* DESIGN.md
* CLAUDE.md
* database documentation
* API documentation
* architecture documentation

Documentation should remain synchronised with implementation.

---

# Development Philosophy

Optimise for long-term quality rather than implementation speed.

The objective is not simply to produce working software.

The objective is to create a product that demonstrates excellent product thinking, outstanding user experience, strong engineering discipline and a distinctive visual identity.

When uncertain:

Stop.

Explain the trade-offs.

Recommend the strongest option.

Then continue only once the direction is clear.
