# UI/UX Acceptance Criteria

Use this checklist before marking any interface task complete.

## 1. Product fit

- [ ] The screen serves a clear user objective.
- [ ] The primary action is obvious.
- [ ] The interface contributes to the Intelligent Product Lab experience.
- [ ] The project remains more visually important than the AI personality.
- [ ] The screen does not resemble a generic chatbot.
- [ ] The screen does not resemble a generic admin dashboard.
- [ ] No decorative AI trope is used without functional meaning.

## 2. Information hierarchy

- [ ] The most important information is visually dominant.
- [ ] Supporting information is available without competing for attention.
- [ ] Moderate density is preserved.
- [ ] Progressive disclosure is used for advanced detail.
- [ ] The current subject and wider project context are both understandable.
- [ ] No more than one dominant interactive object appears in an AI turn.

## 3. Brand and typography

- [ ] Dark theme is polished as the primary experience.
- [ ] Light theme preserves the same hierarchy.
- [ ] Components consume semantic tokens.
- [ ] `#00BF63` is used for action, activation and branded focus.
- [ ] Green is not used as a generic “important” colour.
- [ ] Semantic colours remain consistent.
- [ ] Helvetica-style interface typography is used.
- [ ] Rounded display typography is selective.
- [ ] Monospace is restricted to technical metadata.
- [ ] No unsupported font file is bundled.

## 4. Shape and depth

- [ ] Default component radius is 8px.
- [ ] Pills are used only for genuine pill controls.
- [ ] Permanent panels rely on borders and tonal layering.
- [ ] Shadows are reserved for genuinely floating objects.
- [ ] Card containers are not used for every section.
- [ ] Nested card layouts are avoided.

## 5. Conversation

- [ ] Conversation uses an editorial stream rather than large opposing bubbles.
- [ ] User and AI turns remain clearly attributable.
- [ ] Ordinary responses are concise.
- [ ] Rich blocks appear only when the content requires them.
- [ ] Suggested actions are contextual.
- [ ] No more than three suggested actions are shown.
- [ ] Action wording is consistent.
- [ ] The composer remains in a stable location.

## 6. Canvas

- [ ] The canvas foregrounds the current subject.
- [ ] Wider project context remains available.
- [ ] Only directly relevant graph relationships appear by default.
- [ ] Object types follow the shared visual grammar.
- [ ] Canvas changes occur only for meaningful information.
- [ ] User control is available for pin, hide, collapse, compare and re-centre.
- [ ] A non-drag alternative exists for every important action.

## 7. AI activity

- [ ] Activity describes observable work.
- [ ] No raw chain-of-thought is exposed.
- [ ] No fake progress percentage is shown.
- [ ] No fabricated source or operation is displayed.
- [ ] Research activity is associated with the canvas.
- [ ] Ordinary analysis activity is associated with the active turn.
- [ ] The user can stop or steer a suitable active task.
- [ ] The final result remains; temporary activity fades.
- [ ] Meaningful work produces a concise outcome summary.

## 8. Evidence and trust

- [ ] User statements, AI inference and external evidence are distinguishable.
- [ ] High-impact claims show visible sourcing.
- [ ] Estimates are labelled.
- [ ] Conflicting evidence is visible.
- [ ] Source methodology and limitations are accessible.
- [ ] AI interpretation is not presented as source fact.
- [ ] The UI does not create false certainty through polish.

## 9. Change management

- [ ] Low-risk automatic changes remain visible in history.
- [ ] Structural changes require approval.
- [ ] Connected changes are bundled when they share one strategic cause.
- [ ] Individual affected changes can be inspected.
- [ ] Partial approval warns about inconsistency.
- [ ] Approved bundles can be undone.
- [ ] The user can see what changed, where and why.

## 10. Errors and feedback

- [ ] No generic “Something went wrong” message is used.
- [ ] The user knows what failed.
- [ ] The user knows what remains usable.
- [ ] A relevant next action is provided.
- [ ] Uncertainty is not automatically styled as an error.
- [ ] Red is reserved for material risk, destructive action or failure.
- [ ] Unresolved issues remain attached to relevant project objects.
- [ ] Blocking is used only where continuation is unsafe or incoherent.

## 11. Accessibility

- [ ] Keyboard navigation works.
- [ ] Focus states are clearly visible.
- [ ] Semantic HTML controls are used.
- [ ] Status is not communicated by colour alone.
- [ ] Contrast is sufficient.
- [ ] Text resizing does not break layout.
- [ ] Reduced-motion behaviour remains understandable.
- [ ] Charts have text summaries or data-table access.
- [ ] Screen-reader labels exist.
- [ ] Dynamic updates use appropriate announcements.
- [ ] Interface text size and density controls work.

## 12. Motion

- [ ] Motion communicates addition, change or focus.
- [ ] The canvas remains still while the user reads.
- [ ] There is no decorative particle motion.
- [ ] Nodes do not continuously rearrange.
- [ ] Meaningful changes have a written “What changed” explanation.
- [ ] Reduced-motion mode removes non-essential animation.

## 13. Testing

- [ ] Component states have tests.
- [ ] Keyboard interactions have tests.
- [ ] Theme switching is tested.
- [ ] Reduced motion is tested.
- [ ] Important flows have Playwright coverage.
- [ ] Accessibility checks run in CI.
- [ ] Visual regression coverage exists for core workspace states.
