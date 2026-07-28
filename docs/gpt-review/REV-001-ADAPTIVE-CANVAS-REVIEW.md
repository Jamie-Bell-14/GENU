# REV-001 — Adaptive Canvas Architecture Review

> Status: **Awaiting Claude response**  
> Reviewer: GPT  
> Decision owner: Jamie Bell  
> Reviewed branch: `main`  
> Review scope: current canvas implementation, Phase 0 canvas decisions, post-T7 compliance audit and affected canonical documents
>
> This file is the initial review handoff created while the GitHub review workflow is being introduced. Once the corresponding issue is active and its body contains the maintained summary, this file should be removed or archived so it does not become a competing source of truth.

## Executive verdict

The current canvas implementation is technically coherent and substantially follows the approved T7 task. Claude did not simply ignore the repository documents.

The underlying problem is that the approved Phase 0 architecture narrowed the canvas from a living adaptive visual surface into one permanent zoned representation. The later compliance audit correctly identifies visual hierarchy, motion, editable meaning and card-soup risks, but its proposed T7a refinement still treats the permanent solution as a better-styled stack of zones.

That is insufficient for the intended product.

The canvas should be an **adaptive visual reasoning surface** that selects from controlled visual structures according to what the user is trying to understand or decide. Deferring a fully open Miro-style whiteboard and free user dragging does not require fixing the primary canvas to one list-like renderer.

No implementation change should begin until the canvas architecture and canonical documents are amended and approved.

## Material reviewed

- `PROJECT_PLAN.md`
- `DESIGN.md`
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/VERTICAL_SLICE_SPEC.md`
- `docs/VERTICAL_SLICE_TASKS.md`
- `docs/UI_ACCEPTANCE_CRITERIA.md`
- `docs/review/02-SPECIFICATION_REVIEW.md`
- `docs/review/06-DESIGN_REVIEW.md`
- `docs/review/08-CANVAS_COMPLIANCE_AUDIT.md`
- current post-T7 canvas screenshots and implementation direction

## What is working

- The project has a controlled semantic object vocabulary.
- User-stated, inferred and researched origins are intended to remain distinguishable.
- Support states are qualitative rather than fake precision scores.
- The canvas avoids an unrestricted whiteboard model.
- Keyboard-accessible view operations are treated seriously.
- The current object grammar can be reused inside future renderers.
- The post-T7 audit honestly identifies that adaptive hierarchy is unowned and that the uniform card treatment risks violating the anti-card-soup requirement.

## Findings

### GPT-CANVAS-001 — The canvas architecture is tied to one representation

**Severity:** Blocker  
**Type:** Architecture  
**Status:** Open

**Evidence**

The approved architecture defines `LivingCanvas` as a fixed set of zones—current subject, related concepts, evidence, assumptions and project outline—with all objects rendered through a shared frame. T7 then implements this exact representation.

**Why this matters**

The product vision requires the canvas to help the user reason differently depending on context. A causal question, customer comparison, evidence review and connected-change decision cannot all be expressed effectively through the same vertical zone treatment.

**Recommended action**

Separate three layers:

1. Canonical semantic project model
2. Validated `CanvasScene` specification
3. Controlled renderer selected for the scene

The current zoned view may remain as a structured fallback, inspector or accessibility representation. It should not remain the only primary canvas architecture.

**Acceptance criteria**

- Project data is independent of its current visual representation.
- A validated `CanvasScene` schema exists.
- Application code owns the allowed renderer registry.
- The AI may recommend scene intent and content but cannot emit arbitrary HTML, CSS or unvalidated coordinates.
- The first vertical slice supports at least the three approved scene families in GPT-CANVAS-003.
- The existing zoned view remains available without controlling every experience.

---

### GPT-CANVAS-002 — Deferring free dragging was incorrectly treated as a fixed-layout decision

**Severity:** High  
**Type:** Product and architecture decision  
**Status:** Open

**Evidence**

The Phase 0 review reasonably identified the cost and accessibility implications of free object movement. The approved result deferred free movement, but architecture and task wording then equated that with a permanently zoned renderer.

**Why this matters**

These are separate decisions:

- fully open user-controlled whiteboard editing can remain deferred
- application-controlled adaptive visual structures can still be part of the initial product

Without this distinction, implementation complexity has silently reshaped the product concept.

**Recommended action**

Amend the canonical documents to state explicitly:

> Deferring free user-controlled object movement does not prohibit controlled adaptive visualisations or application-managed spatial layouts.

**Acceptance criteria**

- The deferred-scope list continues to exclude a fully open whiteboard and unrestricted dragging.
- Controlled causal, evidence and change-impact renderers are explicitly permitted.
- Claude cannot cite the dragging deferral as justification for reducing all scenes to fixed zones.

---

### GPT-CANVAS-003 — The vertical slice lacks a minimum adaptive scene set

**Severity:** Blocker  
**Type:** Scope and task planning  
**Status:** Open

**Evidence**

The current task plan schedules feature-specific canvas modes later, but it does not define a shared scene architecture or minimum set that proves the adaptive-canvas concept. The post-T7 audit confirms adaptive behaviour is not owned by any task.

**Recommended initial scene families**

1. **Problem exploration scene**
   - causal or relationship view
   - foregrounds the active problem
   - distinguishes known information, possible causes and unconfirmed consequences

2. **Evidence/research scene**
   - claim, evidence, source, limitation and contradiction relationships
   - includes an accessible structured alternative

3. **Connected-change impact scene**
   - shows affected project areas and dependencies before and after approval
   - supports focused review without becoming a decorative graph

**Acceptance criteria**

- These three scene families share the same semantic project objects.
- Switching scene does not duplicate or mutate canonical project data.
- Each scene defines its own layout grammar and accessible alternative.
- The scene remains stable while the user reads.
- Scene changes have an explicit user-visible reason.

---

### GPT-CANVAS-004 — Adaptive scene selection and stability rules are unspecified

**Severity:** High  
**Type:** AI behaviour and interaction  
**Status:** Open

**Evidence**

The current documents say the canvas may change emphasis or mode, but do not define when a change is justified, how the user understands it, or how stability is preserved.

**Recommended action**

Define a controlled scene-selection contract. It should include:

- current reasoning purpose
- focal object
- visible objects and relationships
- recommended renderer
- emphasis and uncertainty states
- reason for scene recommendation
- whether the scene should replace, augment or preserve the current scene

A scene should change only when:

- the user's active reasoning goal materially changes
- the user explicitly requests another representation
- a major evidence or decision event requires another view
- the current renderer cannot communicate the new task clearly

**Acceptance criteria**

- No rearrangement after every message.
- No movement under the user's cursor while reading.
- Incoming updates can be queued behind a visible `Canvas updated` affordance.
- Users can return to the previous scene.
- Users can select an allowed alternative view.
- Every automatic recommendation states why the representation is changing.

---

### GPT-CANVAS-005 — The proposed T7a visual refinement is necessary but insufficient

**Severity:** High  
**Type:** Review correction  
**Status:** Open

**Evidence**

The post-T7 audit proposes a larger subject block, compact related rows, smaller outline, motion and inline editing. Those changes would improve hierarchy and reduce card soup.

**Why this is insufficient**

They refine one renderer rather than solving the representation architecture. The result would still treat causal exploration, customer analysis, evidence reasoning and decision impact as variations of the same fixed structure.

**Recommended action**

Do not implement T7a as currently proposed. First replace it with an **adaptive canvas architecture task**. The useful T7a items—hierarchy, motion vocabulary, inline editing, assumption alternatives—should become renderer-level requirements inside that task.

**Acceptance criteria**

- No code is changed solely to polish the fixed-zone renderer before the architectural decision.
- Existing T7 work is reused where appropriate rather than discarded.
- Visual hierarchy is defined per scene, not globally as one card hierarchy.

---

### GPT-CANVAS-006 — The canonical AI system specification is absent from the repository

**Severity:** High  
**Type:** Documentation and AI architecture  
**Status:** Open

**Evidence**

`docs/AI_SYSTEM.md` is not currently present in the repository or listed in Claude's required implementation reading order.

**Why this matters**

Canvas scene recommendation is partly AI orchestration behaviour. Without a canonical AI system contract, scene intent, structured output, validation, approval boundaries and activity events risk being implemented ad hoc.

**Recommended action**

Add and approve `docs/AI_SYSTEM.md` before real AI integration. Include the adaptive-canvas scene recommendation contract, provider isolation, validated structured output, observable activity, tool limits and change-approval rules.

**Acceptance criteria**

- `docs/AI_SYSTEM.md` exists and is included in `CLAUDE.md` required reading.
- It distinguishes semantic project updates from scene recommendations.
- Scene recommendations cannot directly mutate project truth.
- All scene outputs are schema validated and renderer allow-listed.

---

### GPT-CANVAS-007 — The active and archived review material is ambiguous

**Severity:** Medium  
**Type:** Repository communication  
**Status:** Open

**Evidence**

`docs/review` contains an approved Phase 0 archive whose individual files still use draft wording, promoted documents that no longer exist at their original paths, and a new active post-T7 audit.

**Recommended action**

Adopt `docs/REVIEW_WORKFLOW.md` and GitHub issues as the active review mechanism. Keep old Phase 0 material as an archive, but clearly label it and do not add future active reviews to the same folder.

**Acceptance criteria**

- Active reviews are discoverable through GitHub issues.
- Closed discussions do not need to be reread for normal tasks.
- Approved conclusions are absorbed into canonical documents.
- `docs/review` is clearly marked as historical archive or reorganised later in a dedicated housekeeping change.

## Decisions required from Jamie

1. Confirm that the primary canvas is an adaptive visual reasoning surface rather than one permanent zoned layout.
2. Confirm that unrestricted free dragging remains deferred while application-managed spatial renderers are permitted.
3. Approve or modify the initial scene families:
   - problem/causal exploration
   - evidence/research
   - connected-change impact
4. Decide whether the current zoned view should serve as:
   - structured fallback
   - inspector
   - accessibility view
   - or a combination of these
5. Confirm that the current T7a proposal should be replaced by an adaptive-canvas architecture task before T8.

## Canonical documents affected

After Jamie approves the direction, GPT should prepare a documentation-only pull request updating:

- `PROJECT_PLAN.md`
- `DESIGN.md`
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_SYSTEM.md` — add as a canonical document
- `docs/VERTICAL_SLICE_TASKS.md`
- `docs/VERTICAL_SLICE_SPEC.md` where scene behaviour needs clarification
- `docs/UI_ACCEPTANCE_CRITERIA.md`

The documentation update must remove contradictions rather than append another optional interpretation.

## Claude response required

Claude should follow `docs/CLAUDE_REVIEW_PROTOCOL.md` and respond to each finding with:

- Agree / Partially agree / Disagree
- Repository evidence
- Architecture and implementation assessment
- Smallest strong resolution
- Canonical documents affected
- Files, schemas, migrations and tests affected
- Risks and alternatives

Claude must not implement or update canonical documents yet.

## Latest agreed direction

No review recommendation has been approved yet.

## Linked work

- GitHub review issue: to be created
- Documentation PR: not created
- Implementation PR: not created
- Verification: not started
