First Vertical Slice — Problem to Evidence-Backed Project Change

1. Objective

Design and build one complete, polished end-to-end journey that proves the central product loop:

Conversation → analysis → research → visualisation → challenge → decision → project evolution

This is not a throwaway prototype.

The journey should use the real brand system, interaction language and reusable components described in DESIGN.md.

The supporting product may remain narrow, but the central experience should feel like the real product.

2. User scenario

The user is exploring a product opportunity in the rental market.

They begin with an imperfect problem statement:

Tenants and landlords argue about the condition of a property when a tenancy ends.

The journey should demonstrate how the platform clarifies, researches and evolves this starting point without inventing certainty.

3. Required journey

Step 1 — Opening

Display:

What problem are you trying to solve?

Secondary options:

I only have a product idea

Help me discover a problem

The user enters the rental-market problem.

Acceptance:

no long onboarding form

no industry selector

no template gallery

opening feels intentional and on-brand

Step 2 — Initial interpretation

The AI:

reflects the stated problem

separates facts from inference

identifies an important ambiguity

asks one focused question

The canvas creates a sparse initial model.

Example:

Property-condition disagreement

Known
• Happens at tenancy end
• Involves tenants and landlords

Possible causes
• Missing evidence
• Conflicting interpretation

Unconfirmed consequence
• Deposit dispute

Acceptance:

inferred information is visibly labelled

the canvas does not overpopulate itself

the user's original meaning remains editable

Step 3 — Assumption challenge

The user makes or confirms an assumption such as:

Smaller letting agents probably experience this most because they have fewer internal resources.

The AI should:

capture the assumption

explain why it may be incomplete

offer credible alternative explanations

choose an adaptive challenge style

present contextual actions

Suggested actions:

Explain my reasoning

Compare segments

Research this

Acceptance:

the AI does not automatically agree

challenge is specific rather than generic

the assumption appears on the canvas with status and confidence language

no numeric confidence percentage is required

Step 4 — User starts research

The user selects:

Research this

The AI begins a real or carefully mocked research flow.

Observable activity appears contextually:

Searching official tenancy-deposit sources…
Reviewing scheme annual reports…
Comparing reporting methods…
Found relevant figures — checking source context…

Provide:

Stop

Add direction

The user may add:

Focus on England and prioritise official sources.

The system states whether that applies immediately or requires the task to restart.

Acceptance:

activity reflects real observable operations

no fake progress percentage

no raw chain-of-thought

activity is subtle enough to ignore

full activity history is available

Step 5 — Evidence-led result

The canvas changes into a progressive research view:

key finding

focused visualisation

why it matters

source markers

deeper exploration action

The displayed information may be mocked until live web research is implemented, but must be explicitly labelled as demonstration data.

The product must not present fabricated statistics as factual.

Actions may include:

Explore data

Inspect sources

Compare segments

Add as evidence

Acceptance:

high-impact claims have visible provenance

estimates and conflicting sources appear differently

the user can inspect methodology

the AI interpretation is separated from the source data

Step 6 — Evidence enters the project

The user selects:

Add as evidence

Observable activity shows:

Adding source to Market evidence…
Linking evidence to Deposit disputes…
Re-evaluating the target-customer assumption…

The AI returns with a concise consequence summary.

Example:

I added the evidence to Market evidence. It supports the existence of deposit disputes, but it does not yet support the claim that smaller agencies experience them more intensely.

Acceptance:

evidence is linked to the relevant canvas concept

the source is accessible

the assumption's state visibly changes if appropriate

the AI does not claim more than the evidence supports

Step 7 — Customer direction is refined

Further discussion produces a proposed direction:

Focus the initial product on independent letting agencies managing 100–500 properties.

The AI must explain:

why this may be stronger

what remains uncertain

what areas are affected

The proposal is one connected change affecting:

Target customer

Problem definition

Value proposition

MVP scope

Acceptance:

the proposal is not automatically applied

the user can inspect all affected changes

the user can edit or exclude one change

the product warns if partial approval creates inconsistency

Step 8 — User approves connected change

The user selects:

Approve direction

The interface shows visible but controlled update activity:

Updating Target customer…
Revising Problem definition…
Aligning Value proposition…
Updating MVP scope…

The canvas highlights affected branches.

The AI returns:

I narrowed the target customer and aligned the MVP around the letting-agency workflow. This is stronger because the previous scope mixed three users and two different purchasing relationships.

Actions:

Review changes

Undo direction

Open MVP scope

Acceptance:

all changes are transactional where possible

the connected change can be undone as one action

individual diffs are available

the user sees why the change matters

Step 9 — Living documents update

Relevant documents show:

current status

what changed

whether the change was automatic or approved

last meaningful source or decision

named milestone version where applicable

Example:

MVP scope
Working draft

Updated from approved customer direction
• Removed tenant-facing onboarding
• Added agency evidence workflow
• Marked deposit-scheme integration as unvalidated

Acceptance:

structural changes are approval-based

low-risk wording updates may occur automatically

all updates remain traceable

the conversation does not narrate every low-level edit

Step 10 — Decision history

Create a decision-timeline entry.

It must include:

decision

reasoning summary

evidence used

alternatives considered

affected areas

remaining uncertainty

proposed by AI

approved by the user

date/time

Actions:

Open evidence

View changes

Reconsider decision

Restore previous version

Acceptance:

no raw chain-of-thought is stored or shown

reasoning is concise, explicit and user-facing

attribution is clear

Step 11 — Milestone checkpoint suggestion

The AI suggests:

Review the problem-discovery checkpoint?

Summary preview:

what appears credible

what remains uncertain

evidence collected

decisions made

acknowledged risks

recommended next direction

Actions:

Review now

Later

Continue exploring

Acceptance:

the checkpoint is suggested, not forced

postponing does not block ordinary conversation

the stage is not presented as permanently complete

4. Required UI surfaces

The vertical slice must include:

opening screen

primary workspace shell

planning navigation

editorial conversation stream

living canvas

contextual action row

adaptive composer

AI activity state

research visual

source/provenance detail

assumption object

connected-change proposal

diff/review interface

living document view

decision history entry

milestone-checkpoint prompt

settings controls for theme, motion, density and text size

5. Required states

For each major surface, implement:

loading

empty

success

recoverable failure

unavailable source

conflicting evidence

pending approval

approved

undone/reverted

reduced-motion behaviour

Do not use generic “Something went wrong” messages.

6. Data and AI boundary

The first vertical slice may use:

real model calls for conversation and structured extraction

real or mocked research

mocked project changes where persistence is not yet complete

However:

demonstration data must be labelled

fabricated sources must not look real

project states should use real application models where feasible

mock behaviour should be isolated behind replaceable interfaces

Suggested interfaces:

DiscoveryEngine
ResearchProvider
ProjectModelStore
ChangeProposalService
DocumentService
DecisionHistoryService

7. Out of scope

Do not add:

mobile layouts

fully open whiteboard editing

founder-personality selection

user-facing skills marketplace

every discovery entry path

direct Claude Code execution

team collaboration

billing

complex project templates

broad analytics dashboard

Do not create dead controls for these features.

8. Completion criteria

The slice is complete when:

the full journey can be completed without broken transitions

the visual identity is coherent across all surfaces

the user understands what the AI is doing

the user can distinguish facts, inference, evidence and decisions

the user can steer research

the user can review and approve a connected change

affected project areas update visibly

the decision rationale and attribution are recorded

the experience works with reduced motion

keyboard navigation is viable

the design review checklist passes

no core surface looks like a generic chatbot or generic dashboard
