# DRAFT — Repository Verification (Phase 0 Review, Part 1)

> Status: draft proposal for review. No project files were modified. Approval required before any implementation.

## 1. Files found

| File | Present | Notes |
|---|---|---|
| PROJECT_PLAN.md | ✅ | Broad MVP plan; predates the vertical-slice strategy |
| PROJECT_PLAN_ADDENDUM.md | ✅ | Merge source; see 03-PLAN_MERGE_PROPOSAL.md |
| DEVELOPMENT_STANDARDS.md | ✅ | References four skills that are **not installed** (see §3) |
| SECURITY_STANDARDS.md | ✅ | Mandatory input to architecture and every task |
| DESIGN.md | ✅ | Most detailed and most recent design authority |
| docs/VERTICAL_SLICE_SPEC.md | ✅ | |
| docs/UI_ACCEPTANCE_CRITERIA.md | ✅ | |
| CLAUDE.md | ✅ | Contains the standing review instruction (§16) |
| CLAUDE_REVIEW_PROMPT.md | ✅ | This review follows it |
| styles/design-tokens.css | ✅ | Dark + light semantic tokens, density/text-size/reduced-motion hooks |
| README.md | ✅ | |

No document referenced by CLAUDE_REVIEW_PROMPT.md is missing.

## 2. Installed skills found

| Skill | SKILL.md | Supporting files | Broken relative references |
|---|---|---|---|
| `.claude/skills/frontend-design` | ✅ valid frontmatter | none (self-contained) | none |
| `.claude/skills/shadcn` | ✅ valid frontmatter | 14 files (rules/, assets/, agents/, evals/, docs) | none |
| `.claude/skills/ui-ux-pro-max` | ✅ valid frontmatter | 41 files (data/, references/, scripts/) | none |

Verification method: every `.md`/`.yml`/`.json` file in the three skills was scanned for relative path references (49 checked). All references to actual skill support files resolve. Paths flagged by the scanner (`package.json`, `components.json`, `.mcp.json`, example `registry.json`) are documentation references to files expected in the *target project*, not skill assets. The `ui-ux-pro-max` search scripts were executed successfully from the repository root.

## 3. Referenced but missing skills — decision needed

`DEVELOPMENT_STANDARDS.md` instructs use of four skills that do **not** exist in `.claude/skills/`:

- `discovery-engine` (Product Discovery section)
- `founder-philosophy` (Product Discovery and Product Strategy sections)
- `supabase-standards` (Database section)
- `react-architecture` (React Architecture section)

CLAUDE.md §4 forbids creating or assuming additional skills without explicit approval. Recommended resolution: during the plan merge, mark these four references as *deferred until the skill exists* (or remove them), and rely on SECURITY_STANDARDS.md + PROJECT_PLAN.md + this review's architecture document for database and React guidance in the meantime. Alternative: commission those skills before Phase 1. **Decision required.**

## 4. Proposed file-location changes

1. **`styles/design-tokens.css` → `src/styles/design-tokens.css`** when the Next.js app is scaffolded, imported from `globals.css` and mapped into Tailwind v4 `@theme` tokens. The file content stays the single source of truth; only its location moves into the app source tree. Until scaffolding, leave it where it is.
2. **`docs/review/`** (this directory) holds Phase 0 drafts, per CLAUDE.md §14. After approval, merged content moves into the canonical documents and these drafts can be deleted or archived.
3. **No other moves recommended.** Top-level standards documents are appropriate at the repository root; `docs/` is appropriate for specs. `.claude/skills/` placement is correct.

## 5. Small documentation defects (fix during merge)

- PROJECT_PLAN.md's "Development Standards" list omits **SECURITY_STANDARDS.md** — the only standards document with an explicit mandatory status. It must be added.
- Duplicated rule sets exist in four places (UI acceptance criteria, anti-pattern lists, deferred-scope lists). CLAUDE.md §13 asks for one canonical source; the merge proposal consolidates these (see 03-PLAN_MERGE_PROPOSAL.md §4).
- DEVELOPMENT_STANDARDS.md's source-of-truth priority conflicts with CLAUDE.md's (see 02-SPECIFICATION_REVIEW.md, finding C1).
