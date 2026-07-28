# PPM — Intelligent Product Lab

An AI-guided environment that helps a user move from an uncertain problem or
product idea to an evidence-backed, implementation-ready product plan.

The central product loop:

> Conversation → analysis → research → visualisation → challenge → decision → project evolution

## Project documents

| Document | Purpose |
|---|---|
| PROJECT_PLAN.md | What is being built (vision, build strategy, phases) |
| SECURITY_STANDARDS.md | Mandatory security requirements for every task |
| DEVELOPMENT_STANDARDS.md | Engineering and workflow standards |
| DESIGN.md | Canonical design system and experience specification |
| docs/ARCHITECTURE.md | Approved technical architecture |
| docs/VERTICAL_SLICE_TASKS.md | Approved implementation task sequence (T1–T15) |
| docs/VERTICAL_SLICE_SPEC.md | The first end-to-end product journey |
| docs/UI_ACCEPTANCE_CRITERIA.md | Canonical UI review checklist |
| docs/SECURITY_REVIEW.md | Security review of the approved architecture |
| CLAUDE.md | Claude Code project instructions |
| docs/review/ | Phase 0 review archive |

## Development

Node ≥ 22.

```bash
npm install        # install dependencies
npm run dev        # start the dev server
npm run build      # production build
npm run typecheck  # strict TypeScript check
npm run lint       # ESLint
npm run format     # Prettier check (format:fix to write)
npm test           # Vitest unit/component tests
npm run test:e2e   # Playwright end-to-end tests
```

Playwright normally downloads its own browser. In sandboxed environments with a
preinstalled Chromium, point the config at it instead:

```bash
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```

## Status

Phase 0 (review, architecture, plan merge) is complete. Implementation follows
docs/VERTICAL_SLICE_TASKS.md in order; T1 (scaffold and tooling) is done.

### Dependency audit note (reviewed 2026-07-28)

`npm audit` reports high-severity findings in transitive, upstream-pinned
dev/build-time dependencies only: `brace-expansion` (via the ESLint 9
toolchain; glob-expansion DoS in a build tool), `postcss` (vendored inside
Next.js), and optional `sharp` (image pipeline; the app serves no
user-supplied images). No non-breaking fix exists yet; resolved by upstream
`next`/`eslint` releases. Runtime application dependencies are unaffected.
Reviewed per SECURITY_STANDARDS.md §16; re-check on each dependency update.
