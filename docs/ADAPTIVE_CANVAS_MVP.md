# Adaptive Canvas MVP

> Status: **Approved product direction**  
> Decision owner: Jamie Bell  
> Approved: 2026-07-28  
> Review source: GitHub issue #4 — `REV-001 — Adaptive canvas architecture`

## 1. Purpose and authority

This document is the canonical MVP specification for the canvas architecture and supersedes any conflicting interpretation of the canvas in:

- `PROJECT_PLAN.md`
- `DESIGN.md`
- `docs/ARCHITECTURE.md`
- `docs/VERTICAL_SLICE_SPEC.md`
- `docs/VERTICAL_SLICE_TASKS.md`
- `docs/UI_ACCEPTANCE_CRITERIA.md`

It narrows the adaptive-canvas vision into a viable vertical-slice implementation. It does not authorise a general-purpose whiteboard or a full Miro-style canvas.

## 2. Approved product decision

The MVP canvas will be a **constrained adaptive visual reasoning surface**.

It will initially support:

1. a **problem-exploration relationship map**
2. an **evidence/research view**

Connected-change impact will be represented as a focused state of the problem-exploration relationship map rather than a separate renderer.

The existing zoned canvas will remain as a structured inspector, accessible alternative and editing view.

Freeform object movement, model-generated positioning and open-whiteboard behaviour remain deferred.

## 3. MVP hypothesis

The canvas must test whether an AI-guided conversation can create and evolve a visual model that helps a user:

- understand a product problem
- distinguish known information from inference and assumptions
- understand relationships between causes, consequences, customers and evidence
- see how research changes the project
- inspect the impact of a proposed connected change

The MVP is not testing whether the product can replace Miro or provide unrestricted diagram creation.

## 4. Required representations

### 4.1 Problem-exploration relationship map

This is the primary visual canvas during early discovery.

It must be able to display explicit relationships between:

- the active problem
- possible causes
- consequences
- affected customers or actors
- assumptions
- known and inferred project information

The active problem is the visual focus. Related information is arranged through an application-owned layout grammar rather than uniform stacked cards.

Required controls:

- focus an object
- expand or collapse a branch
- pin an important object
- hide an irrelevant object
- re-centre on the current subject
- return to the previous focus or scene state
- open an object in the structured inspector

The user does not freely position objects.

### 4.2 Evidence/research view

Research uses a distinct visual representation rather than styling the problem map as another card zone.

It must show:

- the active claim, question or project object being researched
- supporting evidence
- conflicting or weakening evidence
- source relationships
- limitations and methodology
- AI interpretation clearly separated from source material
- what the evidence changes
- what remains unsupported

Every spatial or graphical treatment must have an equivalent structured or tabular representation.

### 4.3 Connected-change impact state

The MVP does not create a third standalone renderer for connected-change impact.

Before approval, the problem-exploration map enters an impact-review state that:

- highlights affected objects and relationships
- shows the path from the proposed change to affected project areas
- reduces the prominence of unrelated context
- links to the focused before/after proposal review
- preserves the existing application approval and undo requirements

The impact state is a temporary emphasis state. It must not mutate canonical project data or imply that a change has been applied before approval.

### 4.4 Structured inspector and accessible view

The current zoned canvas is retained as the structured representation of project information.

It serves three purposes:

1. inspect all visible project objects in a predictable order
2. edit user-owned wording and meaning
3. provide an accessible alternative to spatial representations

The interface must provide an explicit switch between visual and structured representations.

The structured view is not the sole primary canvas and should not force every reasoning activity into the same zone layout.

## 5. Semantic model requirements

Visual layout must not create or imply project truth.

The implementation requires an explicit semantic relationship model before relationship renderers are treated as complete.

Relationships must:

- connect stable project-object identities
- belong to one project
- use a closed, validated relationship vocabulary
- record origin and provenance
- support qualitative uncertainty
- be protected by Row-Level Security
- be queryable independently of the current renderer

The initial relationship vocabulary should cover the MVP needs without attempting to model every future product concept. At minimum it must support equivalent meanings for:

- possible cause of
- consequence of
- affects
- supports
- contradicts or weakens
- derived from

Claude must propose the smallest database design that preserves referential integrity across the existing object types. It may use a stable project-object registry or another database-enforced approach, but must not rely on unchecked visual coordinates or unvalidated polymorphic ids.

The technical design must be explained in the implementation PR, including migrations, ownership checks and rollback considerations.

## 6. Canvas scene contract

Project truth and its current visual representation are separate layers.

A validated `CanvasScene` must describe a view using application-owned data such as:

- scene purpose
- renderer key
- focal object id
- visible object ids
- visible relationship ids
- emphasis state
- user-visible reason for the representation
- scene revision or history reference

The scene must not contain:

- arbitrary HTML
- arbitrary CSS
- executable content
- model-generated component names
- unrestricted coordinates
- database mutations

Renderer keys are allow-listed by application code. Model output is untrusted and schema validated.

Every referenced object and relationship must be verified as belonging to the active project before rendering.

## 7. Scene selection and stability

The canvas must remain stable while the user is reading.

A scene may change when:

- the user explicitly changes representation
- the active reasoning purpose materially changes
- research begins or completes and an evidence view is appropriate
- a connected-change proposal enters or exits impact review
- the current representation cannot communicate the active task clearly

A scene must not rearrange after every conversational turn.

Automatic recommendations must:

- state why the representation is changing
- prefer preserving or augmenting the current scene over replacing it
- allow the user to remain in the current representation
- allow return to the previous scene
- queue non-urgent updates rather than moving content under the user's cursor

Scene state cannot mutate project fields, assumptions, evidence, decisions or documents.

## 8. AI boundaries

The AI may recommend:

- the reasoning purpose
- the focal object
- relevant existing objects and relationships
- an allow-listed renderer
- a concise user-facing reason

Application code decides whether the recommendation is valid and renders it.

The AI must never:

- invent relationships solely to improve a layout
- emit arbitrary visual code
- position objects through free coordinates
- turn inferred information into confirmed project truth
- apply a connected change through a scene recommendation

Relationship creation or modification must use separately validated project-model operations and preserve origin, support and provenance.

## 9. Interaction and accessibility acceptance

The MVP is complete only when:

- the problem-exploration map communicates the active problem and explicit relationships without becoming card soup
- the evidence view visibly distinguishes source material, AI interpretation, conflicts and limitations
- connected-change review highlights affected relationships without implying approval
- visual and structured views operate on the same canonical project data
- all spatial content has an ordered structured alternative
- all view controls are keyboard accessible
- focus order remains predictable
- scene changes are announced politely to assistive technology
- reduced-motion mode removes non-essential movement
- status and relationship meaning are never communicated by colour alone
- the user can edit their original meaning through the structured inspector

## 10. Deliberately deferred scope

The MVP does not include:

- unrestricted dragging
- infinite canvas behaviour
- freehand drawing
- user-created connectors
- arbitrary object placement
- user-authored visual templates
- model-generated layouts or coordinates
- a general-purpose graph editor
- dozens of renderer families
- a separate connected-change renderer
- multiplayer whiteboard collaboration

These remain future product decisions and must not produce dead controls or placeholders.

## 11. Required implementation sequence

This decision replaces the proposed standalone T7a visual-polish task.

Claude must implement the work in the following order, through a separate implementation PR after this document is merged:

### A. Semantic relationship foundation

- define stable cross-object identity
- add the MVP relationship schema, validation and RLS
- add relationship services and tests
- preserve origin, support and provenance

### B. Scene runtime and structured inspector

- add the validated `CanvasScene` contract
- add an allow-listed renderer registry
- convert `LivingCanvas` into a scene host
- retain the existing zoned implementation as the structured inspector and accessible view
- add scene history and return-to-previous behaviour

### C. Problem-exploration renderer

- implement the application-managed relationship layout
- add focus, branch collapse, pin, hide and re-centre operations
- define hierarchy by reasoning purpose rather than equal card treatment
- prove the vertical-slice Step 2 state with explicit relationships

### D. Existing cross-cutting canvas requirements

- implement editable user meaning
- display assumption alternatives and recommended validation where data exists
- add loading, empty, failure and reduced-motion states

### E. Activity and discovery integration

- continue the activity-system work only after the scene foundation is stable
- add validated scene-recommendation events to the discovery engine
- do not allow scene events to mutate project truth

### F. Evidence/research renderer

- implement alongside the existing T10 research work
- use explicit evidence and source relationships
- include the structured/table alternative and honest demonstration-data labelling

### G. Connected-change impact state

- implement alongside the existing T11 proposal work
- highlight affected objects and relationship paths
- reuse the problem-exploration renderer
- preserve transactional approval, history and undo

## 12. Implementation PR requirements

Claude's implementation PR must reference:

- GitHub issue #4
- this approved canonical document
- the documentation PR that introduced it

The PR must report:

- the chosen project-object identity and referential-integrity design
- all migrations and RLS policies
- scene schemas and renderer allow-list
- affected components and services
- tests run
- accessibility checks
- known limitations
- any deviation from this document

Any material deviation requires a new decision from Jamie before implementation continues.
