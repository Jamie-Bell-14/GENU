# Canvas Compliance Audit (post-T7)

> Status: audit only. No code was modified. Assessed against DESIGN.md §§2.1,
> 2.4, 3.3, 3.4, 10, 17, 20, 21; docs/VERTICAL_SLICE_SPEC.md Steps 2, 5, 6, 8;
> and the approved Phase 0 review + docs/VERTICAL_SLICE_TASKS.md.

## 0. Direct answer: what is the current stacked-card canvas?

**It is a primitive/reference implementation of the approved zoned structure — not the finished primary canvas, and not a throwaway accessible list view.**

Precisely:

- **The zoned *structure* is permanent and approved.** Phase 0 decision (review 02 §U2, PROJECT_PLAN.md §17 item 3) replaced DESIGN.md §3.4's "move visible objects" with a structured zoned layout. There is no spatial/graph canvas waiting behind this to replace it. Anyone reading the current UI as a placeholder for a node-graph would be misreading the plan.
- **The current *visual treatment* is a primitive-level implementation, not the designed exploration map.** Every zone renders an identical vertical stack of equal-weight bordered cards. DESIGN.md §3.3 requires the current subject **prominently**, related concepts as secondary, and a **smaller** project outline. That differential prominence is not implemented.
- **It is therefore honest to call the present state "T7 delivered the object grammar and zone model; the adaptive visual hierarchy is outstanding."** T7's own objective line in the task plan asked for "canvas primitives and object grammar" — which is what exists — but it did not schedule the prominence work anywhere else either. **That is a real gap in the approved plan, not merely a deferral, and it is the main finding of this audit.**

Consequence: the "adaptive visual behaviour" you asked about is **not currently owned by any task**. §5 below proposes where it belongs.

---

## 1. Compliance matrix — DESIGN.md

| # | Requirement | Where implemented | Status | Why implemented as shown | Later task expected to deliver |
|---|---|---|---|---|---|
| 2.1 | A meaningful exchange visibly changes the workspace (adds evidence, identifies assumption, updates customer…) | `conversation-pane.tsx`, `living-canvas.tsx` render from the same project; no turn→canvas mutation exists yet | **Missing** | T6 shipped the conversation and T7 the canvas, but the engine that would emit model updates is scripted and writes nothing. Building a fake canvas change would have been theatre | **T9** (engine tool `update_project_model` writes fields/assumptions), **T10** (evidence enters canvas) |
| 2.1 | Turn-to-canvas linkage (design review 06 §4 "signature interaction": outcome line hover/focus lifts the corresponding object) | Not implemented | **Missing** | Depends on turns producing object ids, which needs T9 | **T9 + T11** |
| 2.4 | Interface adapts but controls do not move unpredictably | Shell regions fixed (`workspace-shell.tsx`); canvas header and per-object controls in stable positions | **Complete** | Structural stability was the point of the T5 shell; the canvas adds no moving controls | — |
| 2.4 | Canvas adapts emphasis to the current task | Only `recentre` changes emphasis (`buildZones` in `model.ts`) | **Partial** | Re-centring is the one implemented adaptation. Task-driven emphasis needs a task signal, which the scripted engine does not produce | **T9–T11** |
| 3.3 | Canvas shows the current subject **prominently**, related concepts, evidence, active assumptions, and a **smaller** project outline | Zones exist and are correctly ordered (`ZONES` in `model.ts`; rendering in `living-canvas.tsx`) | **Partial — the notable gap** | Zone *membership* and order are implemented; visual *weight* is uniform. All five zones use the same heading style and the same `CanvasObjectCard`. Verified: no per-zone size, density or typographic differentiation exists in the code | **Unallocated — see §5** |
| 3.3 | Canvas switches between controlled modes (exploration map / research / project model / document / decision / comparison) | Single view only | **Partial (by plan)** | Exploration map is the only mode T7 covered; the others are each scheduled with the feature that needs them | **T10** research view, **T11** comparison, **T12** document view, **T13** decision view |
| 3.3 | Canvas does not display the entire project graph by default | `ZONE_VISIBLE_LIMIT = 4` per zone with honest overflow counts | **Complete** | Prevents overpopulation while never silently hiding (counts are always shown) | — |
| 3.4 | Pin important objects | `applyViewOperation` `pin`/`unpin`; button in `canvas-object.tsx` | **Complete** | — | — |
| 3.4 | Collapse branches | `collapse_zone`/`expand_zone` (zone-level, not per-object branch) | **Partial** | Collapse operates on zones because the model has no parent/child edges yet — there are no branches to collapse. Verified: no relationship field exists on `CanvasObject` | **T9** (when the engine creates related concepts with parentage) |
| 3.4 | Hide irrelevant objects | `hide`/`show` + count | **Complete** | — | — |
| 3.4 | Compare selected objects | Not implemented; no `compare` operation exists | **Deferred** | Task plan T11 out-of-scope line limits comparison to the change-review surface for the slice | **T11** (minimal) |
| 3.4 | Re-centre around a subject | `recentre` + fallback when the object no longer exists | **Complete** | — | — |
| 3.4 | Undo view changes | `reset` + "Undo view changes" control | **Complete** | Single-action restore, matching §3.4 | — |
| 3.4 | Move visible objects | Not implemented | **Deferred (approved)** | Phase 0 decision U2, approved 2026-07-28 and recorded in PROJECT_PLAN.md §17 + the canonical deferred-scope list. Free movement implies a layout engine, drag persistence and a non-drag equivalent for every operation — the largest accessibility and complexity risk in the slice | Post-slice; not scheduled |
| 3.4 | AI maintains the underlying structure | Structure comes from `project_fields`/`assumptions`; the UI never writes model rows | **Complete (by construction)** | View operations are client-only; nothing in the canvas mutates the model | — |
| 10 | Controlled object set: concept, evidence, assumption, decision, document, visualisation | `OBJECT_KINDS` in `model.ts`; all six render | **Complete** | — | — |
| 10 | Evidence object shows evidence status and source access | Kind exists; no source link or provenance affordance | **Partial** | Evidence rows and provenance are T10's deliverable; building a source button with nothing behind it would be a dead control | **T10** |
| 10 | Assumption object shows what is assumed, current support, why it matters, alternatives, recommended validation | Statement, support state and "why it matters" render; **alternatives and recommended validation do not** | **Partial** | `assumptions.alternatives` exists in the migration but is not surfaced; the scripted engine produces none | **T9** (engine populates), presentation currently unowned — see §5 |
| 10 | Decision object shows proposed by / approved by / date / evidence basis / affected areas / uncertainty | Kind exists; fields not rendered | **Deferred** | Decisions do not exist until T11 creates them | **T13** |
| 10 | Document object represents a living artefact | Kind exists; renders title + detail only | **Partial** | Document state/versioning is T12 | **T12** |
| 10 | Visualisation object leads with evidence summary then deeper exploration | Kind exists; no visualisation renders | **Deferred** | Charts arrive with research | **T10** |
| 10 | All types share typography, 8px radius, border logic, consistent status labels | Single `CanvasObjectCard` frame; `rounded-md` (8px token); rail differs by kind only | **Complete** | One frame for all kinds was a deliberate constraint so objects differ by content and status, not bespoke shapes | — |
| 10 | Restrained motion shared across object types | **No motion at all** in canvas components (verified: no transition/animation classes) | **Missing** | T7 delivered static structure; motion was never scheduled | **Unallocated — see §5** |
| 10 | Do not turn the canvas into colourful flowchart software | No connectors, no free colour; colour limited to semantic rails | **Complete** | — | — |
| 17 | Motion communicates addition, change, focus | None implemented | **Missing** | As above | **Unallocated — see §5** |
| 17 | New evidence fades and expands into place; assumption status changes with restrained transition; selected branch becomes prominent while unrelated objects recede | None implemented | **Missing** | Each depends on a change event the engine does not yet emit — but the *capability* is unscheduled regardless | **T9–T11 for triggers; presentation unallocated** |
| 17 | Canvas remains still while the user reads | Trivially satisfied (nothing moves); the deliberate "queue updates behind a quiet affordance" behaviour from design review 06 §8 is not implemented | **Partial** | No live updates exist yet to queue | **T9** |
| 17 | Reduced-motion respected | Tokens zero at `[data-motion="reduced"]`; canvas uses no motion | **Complete (vacuously)** | Will need re-verification once motion exists | **T15** |
| 17 | Written "What changed" feedback accompanies meaningful change | Not implemented | **Missing** | No changes occur yet | **T11** (outcome summary), **T12** (document change list) |
| 20 | First version establishes object grammar, conversation/canvas relationship, evidence and provenance patterns | Object grammar ✅; conversation/canvas coexist but are not related ❌; provenance ❌ | **Partial** | Sequencing: the primitives had to exist before the journey could link them | **T9–T13** |
| 21 | No purple-blue AI gradients, glowing orbs, neural networks, fake analytics, fake progress, unsupported certainty | None present; support states always qualitative | **Complete** | — | — |
| 21 | **No card grids for every section / card soup** (also UI acceptance §4: "card containers are not used for every section", "nested card layouts are avoided") | Canvas renders 5 zones × stacked bordered cards | **⚠ At risk — see §4** | Uniform card treatment was the fastest route to a testable object grammar, but repeated identically across every zone it approaches the pattern DESIGN.md §21 forbids | **Unallocated — see §5** |
| 21 | Every control styled as a pill / excessive glassmorphism / unnecessary hover animation | Absent | **Complete** | — | — |

---

## 2. Compliance matrix — docs/VERTICAL_SLICE_SPEC.md

| Step | Requirement | Where implemented | Status | Why implemented as shown | Later task |
|---|---|---|---|---|---|
| 2 | Canvas creates a **sparse** initial model | `ZONE_VISIBLE_LIMIT`; dev sample is deliberately sparse | **Complete** (structure) / **Missing** (generated from a real turn) | Structure is real; the content is a dev fixture because the engine writes nothing yet | **T9** |
| 2 | Spec's example groups content as *Known* / *Possible causes* / *Unconfirmed consequence* | Current zones are Subject / Related / Evidence / Assumptions / Outline | **Partial — semantic mismatch** | The implemented zones follow DESIGN.md §3.3's vocabulary; the spec's Step 2 example uses an epistemic grouping (what is known vs. inferred vs. unconfirmed). Both are defensible, but they are **not the same grouping**, and no decision reconciled them. Flagged for your call | **Decision needed — see §5** |
| 2 | Inferred information is **visibly labelled** | `ORIGIN_LABELS` text + dashed rail on every object | **Complete** | Text-first so it never depends on colour; the dashed rail is the redundant cue | — |
| 2 | The canvas does not overpopulate itself | Zone limit + overflow counts | **Complete** | — | — |
| 2 | **The user's original meaning remains editable** | No edit affordance anywhere (verified) | **Missing** | Not in T7's scope and **not in any later task's scope either** | **Unallocated — see §5** |
| 5 | Canvas becomes a progressive research view (key finding, focused visualisation, why it matters, source markers, deeper exploration) | Not implemented | **Deferred (planned)** | Explicitly T10 | **T10** |
| 5 | High-impact claims show provenance; estimates and conflicting sources render differently; methodology inspectable; AI interpretation separated from source data | Not implemented | **Deferred (planned)** | T10; `visualisation`/`evidence` kinds are the placeholders | **T10** |
| 5 | Demonstration data explicitly labelled | Partially present: dev fixture carries a "Demonstration data" meta string, but nothing **enforces** it | **Partial** | The `is_demo` enforcement lives with the evidence table in T10; today's demo string is a convention, not a guarantee | **T10** (schema-level `is_demo NOT NULL`) |
| 6 | Evidence links to the relevant canvas concept; source accessible; assumption state visibly changes | Not implemented; no evidence↔concept relation exists in the model | **Deferred (planned)** | T10 adds `evidence` + `evidence_links` | **T10** |
| 8 | Canvas **highlights affected branches** on approval | Not implemented | **Deferred (planned)** | T11 | **T11** |
| 8 | Controlled, visible update activity during application | Not implemented | **Deferred (planned)** | T8 provides the activity transport; T11 the change application | **T8 + T11** |

---

## 3. Compliance matrix — approved review and task plan

| Requirement | Where | Status | Notes |
|---|---|---|---|
| Zoned structured layout instead of free movement (02 §U2) | `ZONES`, `buildZones` | **Complete** | Implemented exactly as approved |
| Pin / collapse / hide / re-centre / compare / undo retained | 5 of 6 implemented; **compare** absent | **Partial** | Compare was narrowed to T11's review surface; the approved text listed it as retained, so this is a scope narrowing worth confirming |
| Canvas renders as ordered, labelled regions (screen-reader coherent) | `<section aria-label>` per zone; `<article>` per object | **Complete** | Verified by component and axe tests |
| Every important action has a non-drag equivalent | All operations are buttons | **Complete** | — |
| Objects never communicate state by colour alone | `ORIGIN_LABELS` / `SUPPORT_LABELS` text on every object | **Complete** | Asserted in tests |
| Qualitative support only; no numeric confidence | `SUPPORT_STATES`; schema enum | **Complete** | — |
| T7 objective as written in the task plan | `src/components/canvas/*`, `src/lib/canvas/*`, migration, RLS | **Complete** | T7's stated deliverables are met; the shortfall is against DESIGN.md, not against T7's own text |

---

## 4. The "card soup" risk, stated plainly

DESIGN.md §21 forbids "card grids for every section"; UI_ACCEPTANCE_CRITERIA §4 requires that "card containers are not used for every section" and that permanent panels "rely on borders and tonal layering".

The current canvas renders **five identically-styled zones, each a vertical stack of identically-styled bordered cards**. With the sparse demo model it reads acceptably (see the T7 screenshots). With a realistic model — a dozen objects across five zones — it will read as a list of boxes, which is the failure mode the design documents name.

This is not a defect against T7's written scope, but it is a genuine divergence from the design intent, and it will get worse as content grows rather than better. I am flagging it now rather than at T15, when it would be expensive to correct.

---

## 5. What is unowned, and where I propose it belongs

Five items are **not scheduled in any task**. They need a decision before further canvas work:

| Unowned item | Proposal |
|---|---|
| **Adaptive visual hierarchy** (subject prominent, related secondary, outline compact) | New **T7a** before T8: differentiate zones by weight — subject as a full editorial block, related/assumptions as compact rows rather than cards, outline as a dense list. Directly addresses §3.3 and the card-soup risk together |
| **Canvas motion** (addition, status change, focus shift; still while reading) | Fold into **T7a** for the primitives, with per-feature triggers landing in T9–T11; re-verified under reduced motion at T15 |
| **Editable user meaning** (Step 2 acceptance) | Small, self-contained: inline edit on user-stated objects writing back to `project_fields`. Propose **T7a** or an explicit T9 sub-item |
| **Assumption alternatives / recommended validation** (DESIGN.md §10.3) | Presentation in **T7a**; content generation in **T9** |
| **Zone vocabulary reconciliation** (spec Step 2's Known / Possible causes / Unconfirmed consequence vs. DESIGN.md §3.3's zones) | **Decision required from you.** Recommendation: keep DESIGN.md's zones as the persistent structure, and let the *subject* block render an epistemic breakdown (known / possible / unconfirmed) inside itself — satisfying both documents without two competing groupings |

## 6. Recommendation

Do **not** proceed to T8 with the canvas as it stands. The zone model and object grammar are sound and should be kept; what is missing is the visual hierarchy that makes it an exploration map rather than a list, plus the motion vocabulary. Both are cheaper to add now, against five demo objects and a passing test suite, than after three more features have built on top of the flat treatment.

Proposed order: decide §5's zone-vocabulary question → **T7a** (hierarchy, motion primitives, inline edit) → **T8** activity system → Phase 3 as planned.
