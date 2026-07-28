# Intelligent Product Lab — Design Kit

This package turns the design-discovery decisions into repository-ready specifications.

## Files

- `DESIGN.md` — canonical product and interface design direction.
- `design-tokens.css` — starter semantic token system for dark and light themes.
- `VERTICAL_SLICE_SPEC.md` — the first end-to-end product journey to design and build.
- `PROJECT_PLAN_ADDENDUM.md` — sections to merge into the existing project plan.
- `UI_ACCEPTANCE_CRITERIA.md` — reusable review checklist for screens and interactions.
- `CLAUDE_REVIEW_PROMPT.md` — prompt for Claude Code to review the repository before implementation.

## Recommended repository placement

```text
/
├── CLAUDE.md
├── PROJECT_PLAN.md
├── DEVELOPMENT_STANDARDS.md
├── DESIGN.md
├── docs/
│   ├── VERTICAL_SLICE_SPEC.md
│   └── UI_ACCEPTANCE_CRITERIA.md
├── styles/
│   └── design-tokens.css
└── .claude/
    └── skills/
        ├── frontend-design/
        ├── shadcn/
        └── ui-ux-pro-max/
```

`PROJECT_PLAN_ADDENDUM.md` is intentionally separate so Claude Code can compare it with the existing plan and merge it without overwriting earlier requirements.

## Before implementation

1. Copy the files into the repository.
2. Ask Claude Code to read all project documents and installed skills.
3. Use the prompt in `CLAUDE_REVIEW_PROMPT.md`.
4. Review Claude's proposed architecture and merge plan.
5. Approve the plan before application code is written.
