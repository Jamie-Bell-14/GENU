# DRAFT — Design Review (Phase 0 Review, Part 6)

> Status: draft for review. Produced with the three installed skills, applied in the order DEVELOPMENT_STANDARDS prescribes: `frontend-design` for direction, `ui-ux-pro-max` for UX/accessibility validation, `shadcn` for implementation primitives only.
>
> A note on skill precedence, verified in practice: `ui-ux-pro-max`'s generic database recommends "AI-Native UI + AI Purple (#6366F1)" and glassmorphism for AI platforms — precisely the styling DESIGN.md §21 bans. Its *accessibility and UX guidelines* (focus rings, tab order, skip links) are adopted; its generic AI-product styling is rejected. DESIGN.md governs, as the addendum requires. Its dark-mode guidance (avoid pure #000, maintain 7:1 body contrast) is consistent with the graphite token set and adopted.

## 1. Visual direction

**Thesis: an instrument, not a chatbot.** The product reads as a precision environment where a project is being assembled under honest laboratory conditions. Everything communicates *state of knowledge*: what is stated, inferred, evidenced, contradicted, decided.

- **Graphite bench, one live colour.** The green-tinted graphite surfaces in the token file stay as the whole environment; `#00BF63` appears only where agency lives — primary actions, focus, selection, active work. On an otherwise achromatic-plus-semantic field, green reads as "this is where the product moves forward". This discipline (not decoration) is the brand.
- **The deliberate aesthetic risk** (per frontend-design): *status is structural, not decorative*. Every canvas object and rich conversation block carries a 2px status rail on its left edge plus a micro-label (evidence-blue, assumption-amber, decision-green, risk-red, opportunity-violet). The interface looks like annotated laboratory record-keeping — a look no default component library produces, and it makes epistemic state the most visible property of the UI, which is exactly DESIGN.md §2.3's demand.
- What is explicitly *not* done: purple gradients, glow, glass, orbs, card grids, dashboard filler, mascot-like AI presence (DESIGN.md §21 enforced as a lint-of-the-eye checklist in every UI task).

## 2. Typography

- **Interface:** Helvetica-led per DESIGN.md §6 — slice ships the system stack (`"Helvetica Neue", Helvetica, Arial, sans-serif`) with tightened sizes from the token scale; body at `--text-sm`/`--text-md`, generous line-height in conversation, tighter in canvas objects.
- **Rounded display face:** reserved for the moments DESIGN.md §6.1 names — the opening question, checkpoint headers, milestone names, key discoveries. ⚑ Decision P2: the specified fallback (Arial Rounded MT Bold) is effectively macOS-only, and no unlicensed font may be bundled. Until Helvetica Now (+ a rounded companion) is licensed, the slice should use the plain display stack at heavier weight rather than bundling an off-brand free rounded face. The moments stay typographically marked (size/weight), and the rounded voice arrives with licensing.
- **Monospace:** timestamps, source metadata, version identifiers, project ids only.
- Type is the hierarchy system; colour never substitutes for it.

## 3. Information hierarchy

Reading order the layout must produce, in every state: **1)** the current subject on the canvas, **2)** the AI's current question/challenge in the conversation, **3)** the contextual actions, **4)** ambient context (nav, outline, activity). Rules that keep it honest:

- One dominant interactive object per AI turn (UI_ACCEPTANCE §2) — a proposal block and a checkpoint block never compete in the same turn.
- The canvas carries detail; the conversation stays concise and references it (DESIGN.md §8.2) — no restating the canvas in prose.
- Activity is legible at a glance and ignorable; it never claims focus, never animates the layout.
- Progressive disclosure everywhere: provenance, methodology, version history, and full activity history are one deliberate step away, never ambient.

## 4. Conversation / canvas layout

- Planning navigation (≈`--workspace-nav-width`, collapsible) · conversation · canvas, divider draggable and keyboard-resizable, focus modes for either working surface, layout remembered. The shell frame is stable; only pane emphasis changes (DESIGN.md §2.4).
- The conversation is an **editorial stream**: user turns marked by a hairline rule + name, AI turns unmarked body text; rich blocks (challenge, proposal, checkpoint, finding) are bordered token-surfaces within the stream, not bubbles. Implementation uses shadcn chat primitives (`MessageScroller` for scroll/anchoring behaviour) with entirely custom row/surface rendering — behaviour from the library, identity from DESIGN.md.
- **Turn-to-canvas linkage** (the signature interaction): when a turn changes the project, its outcome line ("Added evidence · Updated assumption") carries a small status-rail chip; hovering/focusing it lifts the corresponding canvas object's border. Conversation and canvas read as one instrument, which is the anti-chatbot argument made structurally.

## 5. Canvas object grammar

- Zoned layout (current subject / related concepts / evidence / assumptions / project outline), DOM-ordered and screen-reader coherent; no free-floating graph in the slice (⚑U2).
- All six object types share `CanvasObjectFrame`: 8px radius, `--border-subtle` on `--surface-secondary`, status rail + status label, title, one-line body, metadata line (mono, `--text-tertiary`). Objects differ by content and rail, not by shape — grammar, not decoration.
- Origin is always textual: "You stated" / "Inferred" / "Demonstration data" as micro-labels. Inferred material additionally renders with a dashed rail — visible in both themes, colour-independent.
- Density: comfortable ≈ 5–9 visible objects; compact tightens spacing via the density tokens. Overflowed zones collapse behind honest counts ("4 more assumptions").

## 6. Research-view and connected-change treatment

- **Research view** (canvas mode): key finding first as an editorial statement with its source marker; one focused visualisation (token series colours, text summary + data-table toggle beneath — never chart-only); "why this matters" as AI interpretation *visually separated* from source data (labelled sections, evidence-blue rail vs neutral); source markers open the provenance panel (source, date, excerpt, method, limitations, retrieval time). Estimates carry an amber "estimate" chip; conflicting sources render side-by-side with a "sources disagree" header, never averaged. All demonstration data carries a persistent quiet banner-chip: "Demonstration data — not real research".
- **Connected change**: proposal block in-stream shows title, rationale, affected-areas list; "Review changes" opens a **focused sheet** (single column, one item per affected area, before → after stacked with origin labels, include/exclude toggle per item, inconsistency warning inline where the exclusion creates it). Approve is the only green action in the sheet. On approval: affected canvas branches lift briefly, outcome summary block with Review changes / Undo / Open document. Single-column stacked review was chosen over side-by-side diffs deliberately: these are short strategic statements, and stacked reading is calmer and mobile-safe later.

## 7. Activity treatment

- Turn-level analysis activity: one muted line under the active turn, plain text, no spinner theatrics — text itself is the indicator, fading when done.
- Research/canvas activity: a slim strip at canvas top listing observable operations as they happen, with `Stop` and `Add direction` inline; steering answers with its application mode (now / next step / restart) in text.
- Persistent activity control opens full history (activity_events), timestamped, filterable by turn.
- Never shown: percentages, "thinking…", invented operations. Every line maps to a real server-emitted event.

## 8. Motion approach

- Motion only for: something added (evidence fades/expands in, `--motion-standard`), something changed (status rail crossfade), focus moved (branch lift on approval, `--motion-slow` once).
- The canvas is still while the user reads; updates arriving mid-read queue behind a quiet "canvas updated" affordance rather than moving content under the cursor.
- Reduced motion: transitions collapse to instant state changes (tokens already zero the durations); the written "What changed" line — present for everyone — carries the full meaning, so nothing is animation-only.

## 9. Accessibility approach

Adopted from ui-ux-pro-max's guideline set + DESIGN.md §18, enforced structurally:

- Landmarks + skip links for the three-region shell; roving focus within canvas zones; divider is `role="separator"` with arrow-key resize.
- Focus visible everywhere via `--focus-ring`; no outline removal without replacement.
- Status = colour + label + (where iconic) icon, everywhere, verified per component test.
- `aria-live="polite"` for activity phase changes and outcome summaries only (no delta flooding); stream completion announced once.
- Charts ship with text summary and data-table access from the first visualisation.
- Text-size and density controls are real (tokens), tested for non-breaking layout; keyboard-only journey run is a T15 gate; axe in CI from T3.

## 10. Where the skills were used and overruled

| Skill | Used for | Overruled where |
|---|---|---|
| frontend-design | Direction discipline: one aesthetic risk (status-as-structure), restraint elsewhere, copywriting register ("Ask, answer or direct the project…" style — active, specific, no filler) | n/a — consistent with DESIGN.md |
| ui-ux-pro-max | Focus/keyboard/skip-link/contrast guidelines; dark-mode contrast targets; chart accessibility | Its "AI purple + glassmorphism + AI-Native UI" product recommendation — rejected per DESIGN.md §21/addendum §B |
| shadcn | Behaviourally-hard primitives (dialog/sheet/popover/command/resizable/scroll, chat scroll anchoring); composition and a11y rules | Default look and layouts — all primitives re-themed to semantic tokens; no default shadcn page patterns copied |
