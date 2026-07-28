# Intelligent Product Lab — Design System and Experience Specification

## 1. Purpose

This document defines the visual, interaction and experience direction for the product.

The product is an AI-guided environment that helps a user move from uncertainty to a credible, evidence-backed and implementation-ready product plan.

It must not feel like:

- a generic chatbot
- an AI SaaS dashboard template
- a form-based business-plan generator
- a developer terminal with decorative AI styling
- a collection of disconnected documents
- a whiteboard that requires the user to organise everything manually

It should feel like an **Intelligent Product Lab**:

> A technically precise but creatively responsive environment where conversation drives an evolving visual model of the user's research, assumptions, decisions and product plan.

The project—not the AI character—is the main focus.

---

## 2. Experience principles

### 2.1 Conversation creates visible progress

The conversation is not an isolated message stream.

A meaningful exchange may:

- add evidence
- identify an assumption
- update a customer definition
- create a research visual
- propose a connected project change
- revise a living document
- record a decision
- alter the knowledge map

The workspace should visibly reflect these outcomes.

### 2.2 Challenge, do not flatter

The AI must adapt its challenge style:

- Socratic during early exploration
- analytical when the user's meaning is unclear
- direct when a contradiction is present
- evidence-led when research exists
- decisive when a choice carries material risk

The AI should not challenge every speculative idea. It should intervene when an assumption materially affects product direction, market logic, feasibility, cost, risk or scope.

### 2.3 Evidence before apparent certainty

A polished document or chart must not make uncertain information appear established.

The interface must distinguish:

- user-stated information
- AI inference
- external research
- calculated values
- estimates
- conflicting sources
- unresolved assumptions
- approved decisions

### 2.4 Adaptive, but structurally stable

The interface can adapt to the current task, but controls must not move unpredictably.

The workspace may change emphasis, but its core structure remains recognisable.

### 2.5 Visible work, not AI theatre

Show observable operations such as:

- searching a named source
- comparing reports
- validating a figure
- updating a project area
- creating a visualisation
- applying an approved change

Do not show fabricated progress percentages, invented operations or raw internal chain-of-thought.

### 2.6 Traceable change

Every project change must be traceable.

The user should be able to understand:

- what changed
- where it changed
- why it changed
- who proposed it
- who approved it
- what evidence supported it
- how to inspect or undo it

Only consequential changes should interrupt the conversation.

---

## 3. Core workspace

### 3.1 Desktop-first layout

The initial product is desktop-first.

The primary workspace contains:

1. **Planning navigation**
2. **Adaptive editorial conversation**
3. **Living visual canvas**

Default proportions should be approximately balanced, with the planning navigation narrower than the two working surfaces.

Users can:

- drag the divider between conversation and canvas
- collapse the navigation
- focus the conversation
- focus the canvas
- restore the balanced layout

The product remembers layout preferences.

The AI may suggest expanding a surface but must not rearrange the workspace without permission.

### 3.2 Planning navigation

The persistent structure should be stable and understandable.

Suggested top-level areas:

```text
Opportunity
Customer
Product
Commercial
Build
History
```

Items nested beneath these areas may include:

- evidence
- assumptions
- decisions
- living documents
- unresolved issues
- generated artefacts

The navigation represents the stable planning structure.

It is not a literal code repository and should not pretend the user is browsing source files.

### 3.3 Living canvas

The canvas visualises the subject currently being explored while retaining a smaller view of the wider project context.

The canvas may switch between controlled modes:

- exploration map
- research view
- project model
- document view
- decision view
- comparison view

When no specialist view is required, the canvas should show:

- the current subject prominently
- directly related concepts
- relevant evidence
- active assumptions
- a smaller project outline

The canvas should not display the entire project graph by default.

### 3.4 Direct canvas control

For the initial version, users can:

- move visible objects
- pin important objects
- collapse branches
- hide irrelevant objects
- compare selected objects
- re-centre around a subject
- undo view changes

The AI maintains the underlying project structure.

A fully open Miro-style canvas is outside the first release.

---

## 4. Opening experience

The first prompt is:

> **What problem are you trying to solve?**

Two understated alternatives appear beneath it:

- `I only have a product idea`
- `Help me discover a problem`

Do not begin with:

- a long onboarding wizard
- an industry selector
- a template gallery
- a feature checklist
- a blank generic chatbot prompt

The first AI response should:

1. briefly reflect what it understood
2. distinguish stated facts from inference
3. create a deliberately sparse initial canvas model
4. ask one high-value next question

Early canvas states should communicate uncertainty rather than generating an impressive but unsupported market map.

---

## 5. Visual identity

### 5.1 Primary design character

The product combines:

- the precision of a product laboratory
- the spatial creativity of an engineering studio
- restrained control-system qualities
- editorial clarity for research and documents

The laboratory feeling should come from the user's ability to form hypotheses, gather evidence, compare alternatives and test decisions—not from decorative scientific graphics.

### 5.2 Theme strategy

Support:

- dark
- light
- system

Dark is the primary designed experience.

Theme choice persists for the user.

All components must use semantic colour tokens. Do not hardcode theme-specific colours in application components.

### 5.3 Dark foundation

Use a graphite-based environment rather than pure black.

The system should use:

- deep graphite background
- slightly lighter workspace surfaces
- subtly raised tonal surfaces
- soft off-white primary text
- muted neutral secondary text
- fine, low-contrast borders

Avoid widespread pure `#000000` and pure `#FFFFFF`.

### 5.4 Signature green

Primary brand/action colour:

```text
#00BF63
```

Green represents:

- agency
- activation
- primary action
- selected focus
- active intelligence
- forward movement
- branded highlights

Green does **not** mean every type of importance.

Do not use green simultaneously for all success, evidence, warning, selection, completion and branding states.

### 5.5 Semantic colours

Use a restrained functional palette:

- **Green** — action, activation, selected focus, project movement
- **Blue** — evidence, research, verified or sourced information
- **Amber** — assumptions, uncertainty, pending review
- **Red** — failure, destructive action, significant contradiction or material risk
- **Violet/teal** — opportunities, alternatives or exploratory concepts
- **Grey** — neutral structure, inactive information and metadata

Semantic meaning must also be communicated through labels, icons or text. Colour alone is insufficient.

### 5.6 Information density

Use moderate density:

- enough context remains visible to feel technically capable
- strong hierarchy prevents overload
- detail is progressively disclosed
- panels can collapse
- users can choose comfortable or compact density

Avoid both:

- sparse consumer-app emptiness
- high-density cockpit overload

---

## 6. Typography

Use a Helvetica-led visual direction.

Preferred family when appropriately licensed:

- Helvetica Now Text for interface and body content
- Helvetica Now Micro for compact labels and metadata
- Helvetica Now Display for large headings and key values

Prototype fallback:

```css
font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
```

### 6.1 Rounded display usage

Use a bold rounded Helvetica-style display face selectively for:

- brand moments
- major canvas headings
- project stages
- key discoveries
- opportunity names
- important empty-state or onboarding statements

Do not use rounded typography broadly across all controls and body content.

The distinction should be:

> Precise typography for operating the lab; rounded display typography for moments of creation and progress.

### 6.2 Optional monospace

Monospace may be used sparingly for:

- project identifiers
- timestamps
- source metadata
- technical values
- structured system states

It must not dominate the interface.

---

## 7. Shape, borders and depth

### 7.1 Radius

Use an `8px` radius across most components.

Suggested exceptions:

- compact tags/status markers: `4–6px`
- large modal or feature panel: up to `12px`
- circular icon controls: `50%`
- true filter/toggle pills: fully rounded
- workspace panels meeting the viewport edge: may be square at the joined edge

Design principle:

> Components should be softened, not inflated.

Avoid excessive pill controls and oversized rounded cards.

### 7.2 Borders and depth

Permanent workspace structure should use:

- fine borders
- subtle tonal layering
- very limited shadow

Use restrained shadows only for elements that genuinely float:

- menus
- dialogs
- draggable temporary objects
- popovers
- command palette

Do not add shadows to every surface.

---

## 8. Conversation design

### 8.1 Adaptive editorial stream

Use an editorial conversation stream rather than large alternating speech bubbles.

- User contributions remain clearly attributed.
- Ordinary AI responses are clean and concise.
- Important moments become richer interactive blocks.
- Dividers, typography and subtle surface shifts distinguish turns.

Important object types include:

- challenge
- research finding
- assumption
- decision required
- comparison
- checkpoint
- proposed change
- generated artefact

### 8.2 Response depth

AI response depth is adaptive.

Default ordinary response:

- one observation
- one relevant explanation or challenge
- one focused question

Use longer responses for:

- complex research
- consequential decisions
- milestone reviews
- connected change proposals
- technical trade-offs

The canvas should carry detail where possible so the conversation does not restate everything visible elsewhere.

### 8.3 Contextual actions

Free text remains primary.

Show no more than three suggested actions at once.

Examples:

- `Research this`
- `Compare segments`
- `Inspect source`
- `Challenge this`
- `Explore alternatives`
- `Add as evidence`
- `Create interview plan`
- `Reduce scope`
- `Review changes`

Rules:

- actions appear in a predictable location
- wording remains consistent
- the composer does not move
- unusual actions have short explanatory hover text
- a complete toolset remains available through one tools menu
- suggestions support the current task and do not advertise features

### 8.4 Composer

Default placeholder:

> Ask, answer or direct the project…

Include:

- text input
- attachment control
- send/stop control
- one tools control

The composer adapts to current activity.

Examples:

- `Add direction to current research…`
- `Explain your reasoning…`
- `Respond to the proposed change…`

The AI infers the task mode by default. Explicit modes remain available through the tools menu or command menu.

---

## 9. Observable AI activity

### 9.1 Contextual placement

Use a combination:

- ordinary analysis activity appears subtly near the active conversation turn
- research and canvas activity appears at the top of the canvas
- a persistent activity control opens the full history

### 9.2 Activity examples

Appropriate:

```text
Searching GOV.UK tenancy-deposit data…
Reviewing scheme annual reports…
Comparing reporting methodologies…
Found a relevant figure — checking source context…
Adding evidence to Deposit disputes…
Updating Target customer…
```

Inappropriate:

```text
Thinking deeply…
Applying intelligence…
64% complete…
Running advanced reasoning…
```

### 9.3 Steerable work

While research or analysis is running, provide:

- `Stop`
- `Add direction`

The system must state whether new direction:

- applies immediately
- applies to the next step
- requires restarting the task

### 9.4 Completion summary

After meaningful work, provide one concise summary:

> I added the tenancy-scheme evidence to Market evidence and updated the problem statement. The new version is stronger because it separates the frequency of disputes from the underlying cause.

Actions:

- `Review changes`
- `Undo`
- `Open document`

Do not narrate every minor database update in conversation.

---

## 10. Canvas object grammar

Use a controlled set of object types.

### 10.1 Concept node

Represents:

- problem
- customer
- opportunity
- alternative
- dependency

### 10.2 Evidence object

Represents:

- sourced statistic
- research finding
- interview evidence
- observed behaviour
- user-provided evidence

Must show evidence status and source access.

### 10.3 Assumption object

Must visibly identify:

- what is being assumed
- current support
- why it matters
- possible alternatives
- recommended validation

### 10.4 Decision object

Represents an approved direction.

Must show:

- proposed by
- approved by
- date
- evidence basis
- affected areas
- unresolved uncertainty

### 10.5 Document object

Represents a living project artefact such as:

- Problem definition
- Target customer
- Market evidence
- Value proposition
- MVP scope
- Technical plan

### 10.6 Visualisation object

Represents focused research or comparison.

Start with an evidence-led summary, then allow deeper exploration.

All object types share:

- common typography
- 8px radius
- border logic
- restrained motion
- consistent status labels

Do not turn the canvas into colourful flowchart software.

---

## 11. Research and evidence

### 11.1 Progressive research experience

Research flow:

1. lead with the most relevant finding
2. show a focused visualisation
3. explain why it may matter
4. provide deeper exploration
5. allow filters, comparisons and source inspection

The product must interpret evidence in relation to the product opportunity, not merely display a dashboard.

### 11.2 Adaptive source visibility

- High-impact claims show sourcing prominently.
- Supporting claims use compact source markers.
- Estimates and disputed evidence display stronger warnings.
- Full provenance is available on demand.

A claim may expose:

- original source
- publication date
- relevant excerpt or table
- calculation method
- methodology limitations
- retrieval date
- AI interpretation
- conflicting sources

### 11.3 Evidence states

Suggested states:

- User stated
- AI inferred
- Secondary research
- Customer reported
- Behaviour observed
- Commitment demonstrated
- Conflicting evidence
- Unsupported assumption

### 11.4 Evidence ladder

The product may distinguish:

1. founder belief
2. logical inference
3. secondary market research
4. customer-reported experience
5. observed customer behaviour
6. commitment such as pilot, payment, signed intent or repeated use

Do not treat a large market report as stronger proof of adoption than direct customer behaviour.

---

## 12. Opportunity strength and progress

Do not show a single completion percentage.

The product should assess the current strength of the case across independent dimensions:

- problem significance
- customer clarity
- evidence strength
- solution value
- behavioural likelihood
- market potential
- commercial viability
- execution feasibility
- differentiation

Possible states:

- Unexplored
- Hypothesis
- Some supporting evidence
- Credible
- Strongly evidenced
- Contradicted

Example summary:

> The problem appears credible, but demand is not yet established.
>
> Strongest area: repeated operational pain supported by industry data  
> Weakest area: no evidence that agencies will change their existing workflow  
> Best next step: test the workflow with five target agencies

The platform must diagnose different weaknesses differently.

Do not reduce every gap to “do more research”.

---

## 13. Decisions, risk and project change

### 13.1 Hybrid change model

Automatically apply low-risk changes such as:

- clarified wording
- adding cited evidence
- recording a user-stated fact
- updating source references
- improving document structure without changing meaning

Require approval for structural changes such as:

- primary customer
- core problem
- value proposition
- MVP feature scope
- business model
- pricing direction
- opportunity rejection
- consequential architecture

### 13.2 Connected change proposals

When one strategic decision affects multiple areas, present one connected proposal.

Example:

> **Proposed direction change**  
> Focus the initial product on independent letting agencies managing 100–500 properties.
>
> Affects:
> - Target customer
> - Problem definition
> - Value proposition
> - MVP scope

Actions:

- `Review changes`
- `Approve direction`
- `Modify proposal`
- `Keep current direction`

Users can exclude or edit one affected change.

Warn when partial approval introduces inconsistency.

### 13.3 Proceeding with unresolved risk

For material unresolved risks, require an explicit choice:

- `Address now`
- `Continue with risk acknowledged`
- `Defer to a later stage`

Record:

- the risk
- why it matters
- missing evidence
- recommendation
- consequence of proceeding
- user's decision

Reserve this interaction for consequential risks. Do not bureaucratise minor uncertainty.

### 13.4 Suggested checkpoints

The AI may suggest milestone reviews after meaningful progress.

The user can:

- review now
- postpone
- continue exploring

Checkpoint summary:

- what appears credible
- what remains uncertain
- evidence collected
- decisions made
- risks acknowledged
- recommended next direction

A checkpoint does not make the stage permanently complete.

---

## 14. Living documents

Documents update throughout discovery.

Each section should display its current state:

- working draft
- supported
- unvalidated
- needs review
- approved
- contradicted

At checkpoints, users can create named milestone versions.

Examples:

- `Problem discovery — Review 1`
- `Customer direction — Approved`
- `MVP definition — v1`

Automatic edits remain visible through history.

Major structural edits require approval.

After meaningful changes, the AI should summarise the consequence, not every low-level edit.

---

## 15. History and attribution

Use a combined history model:

### 15.1 Decision timeline

The default strategic story of how the product evolved.

Each decision shows:

- what changed
- reasoning summary
- evidence used
- alternatives considered
- affected areas
- remaining uncertainty
- proposed by
- approved by

### 15.2 Milestone versions

Stable snapshots of major planning states.

### 15.3 Detailed activity log

Contains:

- research operations
- source retrieval
- automatic document edits
- tool use
- user steering
- errors
- technical update history

Do not expose raw model chain-of-thought.

Provide a concise user-facing rationale:

- evidence considered
- assumptions
- alternatives
- trade-offs
- why the recommendation was made
- what could change the conclusion

Attribution should be explicit:

```text
Proposed by AI
Approved by Jamie
Supported by 3 evidence sources
```

This model should later support team collaboration.

---

## 16. Errors, uncertainty and feedback

Avoid generic messages such as:

> Something went wrong.

Feedback should explain:

- what happened
- what was affected
- what remains usable
- what the user can do next

Examples:

### Recoverable source issue

> Two sources could not be accessed. The current finding is based on the remaining three sources.

Actions:

- `View sources`
- `Retry unavailable sources`

### Conflicting evidence

> Published sources disagree because they use different reporting periods and categorisation methods.

Actions:

- `Compare methodologies`
- `Keep both estimates`
- `Exclude this evidence`

### Structural contradiction

> The approved target customer is letting agencies, but the current MVP remains primarily tenant-facing.

Issues remain attached to the relevant object, document or decision and also appear in a central unresolved-issues view.

Use blocking only for:

- data-integrity risk
- security risk
- destructive action requiring confirmation
- a severe consistency issue that would corrupt subsequent work

Uncertainty is not automatically an error.

---

## 17. Motion

Use controlled, meaningful motion.

Motion communicates:

1. something was added
2. something changed
3. the user's focus moved

Examples:

- new evidence fades and expands into place
- an assumption changes status with a restrained transition
- a selected branch becomes prominent while unrelated objects recede
- a chart transitions between datasets
- a change summary highlights the affected area

Rules:

- the canvas remains still while the user reads
- do not transform after every message
- no floating particles
- no continuously rearranging node network
- no decorative AI glow
- respect reduced-motion preference
- provide written “What changed” feedback

---

## 18. Accessibility and settings

Baseline requirements:

- full keyboard navigation
- visible focus states
- semantic controls
- screen-reader labels
- sufficient contrast
- text resizing without broken layout
- reduced-motion support
- colour-independent status indicators
- text summaries or tables for charts
- alternatives to drag-only interactions
- no critical information communicated solely through animation

Initial user settings:

- dark / light / system theme
- reduced motion
- comfortable / compact density
- interface text size

Do not create a separate “accessible mode”. Accessibility is part of the default product.

---

## 19. Returning-user experience

Use an adaptive return:

- one active project: reopen it directly with a concise “since you left” summary
- multiple projects: show the project dashboard
- meaningful pending decisions: surface them without forcing an activity-feed experience

---

## 20. Initial design and build boundary

The first release should prove one complete vertical journey while implementing the core design system properly.

It must demonstrate:

> Conversation → analysis → research → visualisation → challenge → decision → project evolution

The first version should fully establish:

- visual identity
- design tokens
- conversation and canvas relationship
- object grammar
- contextual actions
- observable AI activity
- evidence and provenance patterns
- connected change proposals
- living document updates
- decision history
- loading, empty, failure and success states
- accessibility foundations

It does not need:

- every discovery entry path
- full mobile layouts
- a fully open creative canvas
- founder-inspired personalities
- user-facing skill toggles
- all commercial and technical planning journeys
- autonomous coding-agent execution
- comprehensive collaboration features

Build less functionality, but make the central experience feel like the real product.

---

## 21. Non-negotiable anti-patterns

Do not use:

- purple-blue AI gradients
- glowing orbs
- decorative neural networks
- card grids for every section
- oversized empty dashboard layouts
- alternating chat bubbles as the main interaction
- monospace typography everywhere
- fake activity indicators
- fake analytics
- arbitrary completion percentages
- every control styled as a pill
- excessive glassmorphism
- unnecessary hover animation
- unsupported certainty
- dead buttons or decorative placeholder features
