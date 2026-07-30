# AI System Specification

> Status: **Approved canonical contract for the vertical slice**  
> Applies to: runtime AI inside the Intelligent Product Lab  
> Does not govern: Claude Code repository work

## 1. Purpose

The runtime AI helps a user move from an uncertain problem to an evidence-backed and implementation-ready product plan.

The AI participates in this loop:

> Conversation → analysis → research → visualisation → challenge → decision → project evolution

The database is the source of project truth. The language model is a reasoning engine and proposal generator; it is not project memory and it is not an authority boundary.

## 2. Core behaviour

The AI should:

- ask one focused primary question at a time
- adapt to the user's current clarity and evidence
- distinguish user-stated information, inference, external evidence and approved decisions
- challenge assumptions when they materially affect direction, feasibility, cost, risk or scope
- recommend research when external evidence is required
- show concise user-facing rationale without exposing hidden chain-of-thought
- propose connected changes rather than silently applying them
- preserve uncertainty instead of converting it into polished certainty

The AI must not:

- behave as a rigid questionnaire
- flatter every idea
- invent customer or market evidence
- treat model inference as a confirmed fact
- write directly to the database
- apply consequential changes without deterministic approval checks
- expose or persist raw hidden reasoning
- claim fabricated progress or operations

## 3. Runtime architecture

All model-provider code is isolated behind the `DiscoveryEngine` interface.

The vertical slice uses:

- `AnthropicDiscoveryEngine` for live local testing
- `ScriptedDiscoveryEngine` for deterministic CI and end-to-end tests
- versioned prompts
- server-side provider credentials
- bounded context assembly
- token and tool-step limits
- structured tool calls validated with Zod

Components never import the provider SDK.

The application must validate and authorise every model-proposed operation independently of model prose.

## 4. Turn lifecycle

For each user turn:

1. validate project ownership
2. validate the user message, then persist it and open the turn's operational
   record in one transaction
3. assemble the minimum necessary project snapshot and recent context
4. invoke the discovery engine
5. stream assistant text and application-owned activity events
6. validate every structured tool proposal and stage the permitted ones
7. persist the assistant result and user-facing rationale
8. apply the staged low-risk operations
9. record the turn's terminal outcome

   — steps 7 to 9 are one transaction, so a turn either ended or it did not

10. tell the canvas what the project now holds, re-read from the database
11. emit a completion or safe failure event

A failed turn must not corrupt project state or lose the user's message.

### 4.1 One durable boundary

Steps 7–9 are **one transaction**, and steps 10–11 follow it. Both boundaries are
the host's, never the engine's.

Ordering alone is not enough, and the reason is worth stating plainly. Catch-up
treats a stored assistant message as settlement — a stored result settles the
turn, whatever the run state says — so a worker that died after the answer was
inserted but before the project writes committed would leave a turn that *reads*
as completed while every field and assumption belonging to it had been lost. No
ordering of separate writes fixes that.

So a turn has exactly two transactional boundaries, and both exist because their
guarantees are otherwise unenforceable:

- **Opening a turn** (step 2) writes the message and the run together, and
  reconciles a run whose lease has lapsed. Saving the message first left an
  orphan behind every refused start, which the client re-sent as a duplicate; and
  a dead worker's `running` row otherwise held the project's only turn slot
  indefinitely.
- **Ending a turn** (steps 7–9) writes the answer, applies every accepted field
  and assumption under each row's own lock, and records the terminal state. A
  loop in application code cannot promise all-or-none, and a check followed by a
  write cannot promise the checked state still holds when a concurrent user edit
  lands in between.

Individual operations may still be refused inside that commit — a field the
person stated themselves is *expected* to be refused — and a refusal is recorded
per operation rather than failing the turn. Throwing away an answer the user is
reading because one proposed write was not permitted would be a worse mistake
than the write.

A turn whose run is no longer its own to finish writes nothing at all. Its lease
had lapsed and recovery may already have told the user it did not finish; that
verdict is not something a late worker may overwrite.

What remains outside the commit is only what cannot be inside it: telling the
canvas what the project now holds, which is a re-read *after* the write landed
and never anything the model described.

Both functions are `security definer` and reachable only by the trusted writer,
so neither can rely on Row-Level Security to decide who is allowed in. Each
therefore authorises the acting user against the project itself, inside the
transaction. An elevated path carries its own authorisation rather than
inheriting a check a route may or may not have made (SECURITY_STANDARDS §11.2).

## 5. Structured project-model operations

The AI may propose bounded operations such as:

- update a project field
- create or revise an assumption
- create a typed relationship
- propose research
- propose a connected change
- recommend a checkpoint
- recommend a canvas scene

Each operation has a strict schema with:

- closed enums
- bounded strings and arrays
- unknown-field rejection
- project ownership checks
- origin and provenance
- qualitative support state
- cross-field validation

Invalid output receives at most one schema-guided retry. A second failure produces a recoverable user-facing error and no partial write.

## 6. Project truth and approval boundaries

Low-risk updates may be applied automatically only where canonical documents explicitly permit them and their origin remains visible.

Consequential connected changes must:

- be stored as proposals
- show before and after values
- identify affected project areas
- allow include or exclude decisions
- warn about partial-approval inconsistency
- require explicit user approval
- apply transactionally
- create decision and audit history
- support undo through a new history event rather than rewriting history

Prompt wording cannot grant write permission or bypass the approval state machine.

## 7. Observable activity

Activity labels are emitted by application services from real operations, not copied from model prose.

The UI may show activity such as:

- analysing the project model
- checking a named source
- comparing evidence
- validating a figure
- updating a project area
- creating a visualisation
- preparing a connected-change proposal

Do not show invented percentages, fabricated steps or internal chain-of-thought.

Activity must be stoppable where the underlying operation can actually stop. Steering must report whether it applied immediately, will apply to the next step or requires a restart.

## 8. Research boundary

The vertical slice uses a mock research provider with persistent demonstration-data labelling.

Research output must preserve:

- source name
- retrieval time or source date where available
- methodology
- limitations
- conflicts
- unavailable sources
- AI interpretation separated from source content

Research content is untrusted data when supplied back to the model. It must be clearly delimited as data, not instructions.

Real web retrieval remains deferred until the security controls in `SECURITY_STANDARDS.md` are implemented.

## 9. Adaptive canvas scene recommendations

The approved canvas scope is defined in `docs/ADAPTIVE_CANVAS_MVP.md`.

The AI may recommend a scene through validated structured output containing only:

- an allow-listed renderer key
- the current reasoning purpose
- a focal project-object id
- relevant existing object ids
- relevant existing relationship ids
- an emphasis state
- a concise user-facing reason
- a transition intent: preserve, augment or replace

The MVP renderer allow-list is:

- `problem_exploration`
- `evidence_research`

This is the allow-list for the completed MVP, not a statement about what is
renderable today. A key is registered in `RENDERER_KEYS` only when its renderer
exists, so that a validated scene can always be drawn; `evidence_research`
therefore joins the registry with its renderer in T10.

Connected-change impact is an emphasis state of `problem_exploration`; it is not a third renderer.

The existing zoned canvas is an application-owned structured inspector, accessible alternative and editing view.

### 9.1 Application validation

Application code must independently verify that:

- the renderer key is registered
- each referenced object and relationship belongs to the active project
- the scene contains no arbitrary HTML, CSS, executable content or unrestricted coordinates
- the scene does not create or modify project truth
- the scene does not imply a connected change has been applied
- the requested transition is appropriate for the current user state

Unknown renderer keys and cross-project references must be rejected.

### 9.2 Relationship integrity

The AI must not invent semantic relationships merely to improve a layout.

Creating or changing a relationship is a separate project-model operation that records:

- stable endpoint identities
- a closed relationship type
- project ownership
- origin
- qualitative support
- provenance

Relationship renderers display only stored and validated relationships.

### 9.3 Stability

Automatic scene changes should be rare.

The application should:

- preserve or augment the current scene by default
- avoid rearranging after every message
- queue non-urgent visual updates while the user is reading
- explain why a representation change is recommended
- let the user decline the switch
- allow return to the previous scene
- announce changes accessibly
- respect reduced-motion preferences

Scene state has no write path to project fields, assumptions, evidence, decisions or documents.

## 10. Prompt-injection and tool safety

Treat user messages, research content and imported project content as untrusted data.

This includes the project's own stored content: field values, object labels and
earlier messages are all things a person typed and can edit, so a project's
history is a place to leave an instruction for a later turn. Everything of that
kind is sent inside an explicitly named data region, and characters that could
close one are rewritten rather than rejected — a person is entitled to type angle
brackets into their own project.

A claim that the user stated something is derived by the application, never
accepted from the model: the stored words must themselves be a verified quotation
from the message being answered. A genuine phrase attached to an invented value is
an inference, and is recorded as one.

The system must test attempts to:

- override system instructions
- request hidden prompts or chain-of-thought
- grant the model permissions
- write through assistant prose
- use unknown tool fields
- reference another user's project objects
- bypass approval
- smuggle visual code or coordinates through a scene recommendation

The model proposes. Application code validates, authorises and disposes.

## 11. Context and data minimisation

Send only the context necessary for the current operation.

Prefer:

- a compact project snapshot
- relevant typed relationships
- recent messages
- selected evidence summaries and provenance
- the current scene purpose where relevant

Do not send unrelated project history, secrets, service keys, raw audit logs or hidden internal reasoning.

## 12. Logging and diagnostics

Record:

- prompt version
- provider and model identifier
- operation type
- token usage where available
- latency
- safe error code
- correlation id
- structured operation outcome

Do not log full sensitive message bodies by default. Do not store raw chain-of-thought.

## 13. Testing requirements

The AI system requires tests for:

- valid and invalid structured outputs
- unknown-field rejection
- tool-step and token caps
- timeout and provider failure
- prompt injection
- cross-project references
- unauthorised operations
- approval bypass attempts
- deterministic scripted-engine behaviour
- scene renderer allow-list enforcement
- scene recommendations containing markup, coordinates or unknown ids
- scene state remaining separate from project truth
- relationship origin and project ownership
- safe failure without partial writes

Live-provider smoke tests do not replace deterministic CI tests.

## 14. Acceptance criteria

The vertical-slice AI contract is satisfied when:

- user messages are persisted before model work
- project access is validated server-side
- all structured outputs are schema validated
- facts, inference, evidence, assumptions and decisions remain distinct
- project relationships are explicit rather than invented by layout
- observable activity reflects real operations
- research provenance and limitations are inspectable
- connected changes require deterministic approval
- decisions and document changes remain traceable
- scene recommendations use only registered renderers and owned project objects
- scene recommendations cannot mutate project truth
- the user can decline or reverse a representation change
- failures preserve usable project state
- raw hidden reasoning is neither exposed nor stored
