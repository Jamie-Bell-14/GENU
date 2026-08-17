/*
  Connected-change proposals, documents and decisions (docs/VERTICAL_SLICE_TASKS.md
  T11, docs/ARCHITECTURE.md §11-13, docs/AI_SYSTEM.md §5).

  Three things land together because approval writes all three atomically:

  - `change_proposals` / `change_items` — a model's proposed intent, stored
    durably but inert until a person approves it. Creation goes through
    `complete_turn` below, alongside fields and assumptions: a proposal a
    model makes mid-turn is only kept if the turn's own transaction commits,
    exactly like every other staged write.
  - `documents` / `document_versions` — the living-document model T12 renders.
    T11's own concern is narrower: a version is created only as part of an
    approved or undone change here; the auto-applied low-risk path
    (`complete_turn`'s existing field writes) does not yet write one, and
    retrofitting it is explicitly out of scope for this task.
  - `decisions` / `decision_evidence` — the Step 10 decision record. Declared
    now, alongside `document_section` on the item-target enum, so a later
    task adds rows rather than enum or table churn (the same reasoning
    `project_object_kind` already used for these two kinds). `decision_evidence`
    is not populated by this migration's functions; nothing in T11 cites
    evidence against a proposal.

  Security model: every write to these tables goes through
  `apply_change_proposal` or `undo_change_proposal`, both `security definer`,
  granted directly to `authenticated` (never through the service-role trusted
  writer — this is a user-initiated action, not a system one, so there is a
  real `auth.uid()` to check). Deliberately not `security invoker`: these
  functions have to write `audit_events`, `document_versions` and `decisions`,
  none of which grant `authenticated` any write access at all — the same
  tamper-resistance `audit_events` already has for turn history. Reaching for
  invoker rights here would mean opening blanket INSERT on those tables to
  every project owner, which is a materially weaker guarantee than "the one
  audited function is the only way in". `security definer` with an explicit
  `auth.uid()` ownership check, mirroring `assert_project_actor`, keeps that
  guarantee while still being reachable directly from the user-scoped client
  — no service-role key touches this path at all (docs/ARCHITECTURE.md §7:
  "the service-role key is not used by the application in the slice").
*/

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type public.change_proposal_status as enum (
  'proposed',
  'approved',
  'partially_approved',
  'rejected',
  'undone'
);

-- 'document_section' is declared now, unused until documents have their own
-- independently-editable sections; every T11 item targets a project field.
create type public.change_item_target_type as enum (
  'field',
  'document_section'
);

create type public.document_slug as enum (
  'problem_definition',
  'target_customer',
  'value_proposition',
  'mvp_scope'
);

create type public.document_version_origin as enum (
  'ai_auto',
  'ai_approved',
  'user'
);

-- ---------------------------------------------------------------------------
-- Proposals
-- ---------------------------------------------------------------------------

create table public.change_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The turn whose `complete_turn` call created this proposal, so a reload
  -- can re-attach the in-stream review card to the conversation turn it
  -- belongs to (T11) — the same correlator `research_findings.turn_id`
  -- already uses: not a foreign key, since it names a turn rather than a
  -- row that must always exist.
  source_turn_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  rationale text not null check (char_length(rationale) between 1 and 1000),
  remaining_uncertainty text
    check (remaining_uncertainty is null or char_length(remaining_uncertainty) <= 500),
  -- Only the model proposes in this slice; a literal check rather than a
  -- one-value enum, so a later 'user' value is a migration, not a rename.
  proposed_by text not null default 'ai' check (proposed_by = 'ai'),
  status public.change_proposal_status not null default 'proposed',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint change_proposals_decided_matches_status
    check ((status = 'proposed') = (decided_at is null))
);

create index change_proposals_project_idx
  on public.change_proposals (project_id, created_at desc);

create table public.change_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.change_proposals (id) on delete cascade,
  target_type public.change_item_target_type not null default 'field',
  area public.project_area not null,
  key text not null check (char_length(key) between 1 and 64),
  /*
    The field's real value, read fresh from `project_fields` by
    `complete_turn` the instant this row is created — never the model's own
    claim (T11 review round 1, P1; docs/ARCHITECTURE.md §11). `apply_change_proposal`
    later re-reads the field again and compares against this column, so the
    whole staleness check is a genuine database-to-database diff. Null means
    the field did not exist yet at that instant: approval then creates it,
    and undo deletes it rather than setting it back to an empty value.
  */
  before text check (before is null or char_length(before) <= 2000),
  after text not null check (char_length(after) <= 2000),
  /*
    The field's own origin/support at the same moment `before` was snapshotted
    (T11 review round 2, P1) — so `undo_change_proposal` can restore what
    approval overwrote in full, not only the text. Null exactly when `before`
    is null (the field did not exist yet, so it has no prior provenance to
    restore).
  */
  before_origin public.field_origin,
  before_support public.support_state,
  /*
    What the person decided for this item. Defaults to included, matching
    "the proposal is not automatically applied" being about the *proposal*,
    not a request that every item start pre-excluded — the reviewer excludes
    what they disagree with, per DESIGN.md §13.2.
  */
  included boolean not null default true,
  applied_at timestamptz,
  -- One item per (area, key) per proposal — a proposal does not propose the
  -- same field twice.
  unique (proposal_id, area, key)
);

create index change_items_proposal_idx on public.change_items (proposal_id);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  slug public.document_slug not null,
  title text not null check (char_length(title) between 1 and 120),
  -- Added as a real FK once document_versions exists, below.
  current_version_id uuid,
  created_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  -- Ordered sections, each independently stated and stated once — not a
  -- prose blob, so a later reader can show "what changed" per section
  -- rather than diffing free text (docs/ARCHITECTURE.md §12).
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  origin public.document_version_origin not null,
  change_proposal_id uuid references public.change_proposals (id),
  milestone_name text check (milestone_name is null or char_length(milestone_name) <= 120),
  created_at timestamptz not null default now()
);

create index document_versions_document_idx
  on public.document_versions (document_id, created_at desc);

alter table public.documents
  add constraint documents_current_version_fk
    foreign key (current_version_id) references public.document_versions (id);

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  reasoning_summary text not null check (char_length(reasoning_summary) between 1 and 1000),
  alternatives jsonb not null default '[]'::jsonb
    check (jsonb_typeof(alternatives) = 'array'),
  remaining_uncertainty text
    check (remaining_uncertainty is null or char_length(remaining_uncertainty) <= 500),
  proposed_by text not null default 'ai' check (proposed_by = 'ai'),
  -- Never the model: a decision exists only because a person approved it.
  approved_by uuid not null references auth.users (id),
  change_proposal_id uuid references public.change_proposals (id),
  created_at timestamptz not null default now()
);

create index decisions_project_idx on public.decisions (project_id, created_at desc);

create table public.decision_evidence (
  decision_id uuid not null references public.decisions (id) on delete cascade,
  evidence_id uuid not null references public.evidence (id) on delete cascade,
  primary key (decision_id, evidence_id)
);

-- ---------------------------------------------------------------------------
-- project_objects registration (docs/ADAPTIVE_CANVAS_MVP.md §5) — documents
-- and decisions join the identity registry the same way fields, assumptions
-- and evidence already do, so a future relationship can reference either
-- without a polymorphic id.
-- ---------------------------------------------------------------------------

insert into public.project_objects (id, project_id, kind)
select id, project_id, 'document' from public.documents
on conflict (id) do nothing;

insert into public.project_objects (id, project_id, kind)
select id, project_id, 'decision' from public.decisions
on conflict (id) do nothing;

create trigger documents_register
  before insert on public.documents
  for each row execute function private.register_project_object('document');

create trigger documents_deregister
  after delete on public.documents
  for each row execute function private.deregister_project_object();

create trigger decisions_register
  before insert on public.decisions
  for each row execute function private.register_project_object('decision');

create trigger decisions_deregister
  after delete on public.decisions
  for each row execute function private.deregister_project_object();

alter table public.documents
  add constraint documents_id_project_uniq unique (id, project_id),
  add constraint documents_object_fk
    foreign key (id, project_id)
    references public.project_objects (id, project_id)
    on delete cascade
    deferrable initially deferred;

alter table public.decisions
  add constraint decisions_id_project_uniq unique (id, project_id),
  add constraint decisions_object_fk
    foreign key (id, project_id)
    references public.project_objects (id, project_id)
    on delete cascade
    deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Row-Level Security
--
-- Read-only for `authenticated`, on every table above: exactly the
-- `audit_events`/`document_versions`/`decisions` pattern docs/ARCHITECTURE.md
-- §7 already calls for — "no UPDATE/DELETE policies at all... history
-- tamper-resistant at the database layer". There is deliberately no INSERT
-- policy either: every write happens inside `complete_turn` (proposal
-- creation, service-role) or `apply_change_proposal`/`undo_change_proposal`
-- (decision, security-definer, below), never as a direct table write.
-- ---------------------------------------------------------------------------

alter table public.change_proposals enable row level security;
alter table public.change_items enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.decisions enable row level security;
alter table public.decision_evidence enable row level security;

create policy change_proposals_select on public.change_proposals
  for select to authenticated using (private.is_project_owner(project_id));

create policy change_items_select on public.change_items
  for select to authenticated using (
    exists (
      select 1 from public.change_proposals cp
      where cp.id = change_items.proposal_id
        and private.is_project_owner(cp.project_id)
    )
  );

create policy documents_select on public.documents
  for select to authenticated using (private.is_project_owner(project_id));

create policy document_versions_select on public.document_versions
  for select to authenticated using (
    exists (
      select 1 from public.documents d
      where d.id = document_versions.document_id
        and private.is_project_owner(d.project_id)
    )
  );

create policy decisions_select on public.decisions
  for select to authenticated using (private.is_project_owner(project_id));

create policy decision_evidence_select on public.decision_evidence
  for select to authenticated using (
    exists (
      select 1 from public.decisions dec
      where dec.id = decision_evidence.decision_id
        and private.is_project_owner(dec.project_id)
    )
  );

grant select on public.change_proposals to authenticated;
grant select on public.change_items to authenticated;
grant select on public.documents to authenticated;
grant select on public.document_versions to authenticated;
grant select on public.decisions to authenticated;
grant select on public.decision_evidence to authenticated;

-- service_role writes proposals through `complete_turn`, below.
grant select, insert on public.change_proposals to service_role;
grant select, insert on public.change_items to service_role;

/*
  Nothing else is granted here. `apply_change_proposal` and
  `undo_change_proposal` (below) are `security definer`, so they run with
  their owning role's privileges on every table they touch — the same as
  `complete_turn` already does for `project_fields`/`messages`/`turn_runs`
  without any table grant of its own. The only grant either needs is
  `execute` on the function itself, alongside each function's definition.
*/

/*
  New audit vocabulary for the approval/undo functions defined in the next
  migration. Added here, in a migration that never uses them as a literal,
  because a value added by `alter type ... add value` cannot be used inside
  the same transaction that adds it (the existing `operation_applied` /
  `operation_rejected` pair was split across two migrations for the same
  reason — see 20260729120000_turn_lease_renewal.sql).
*/
alter type public.audit_action add value if not exists 'proposal_approved';
alter type public.audit_action add value if not exists 'proposal_rejected';
alter type public.audit_action add value if not exists 'proposal_undone';

-- ---------------------------------------------------------------------------
-- Assumption lifecycle, tied to the proposal it was inferred alongside
-- ---------------------------------------------------------------------------

/*
  A connected-change proposal correctly gates project-field writes behind
  explicit approval, but an assumption the model infers in the *same turn* as
  a `propose_connected_change` call — the reasoning behind the direction it is
  proposing — was written straight into `assumptions` as active, visible,
  canonical project truth, regardless of whether that proposal was ever
  approved. Rejecting or undoing the proposal left the assumption behind,
  looking like settled truth for a direction the person explicitly did not
  adopt (T11 manual QA, issue #28).

  `source_change_proposal_id` names the proposal an assumption was inferred
  alongside, when there was one; `pending_decision` is what actually gates
  visibility. Every read that treats assumptions as active project truth
  (`loadCanvasObjects`, which also supplies the model's own scene/context
  inventory) excludes a row while this is true. `apply_change_proposal`
  clears it on an approval or partial approval — promoting the assumption
  the same moment the direction it reasons about becomes real —
  and `undo_change_proposal` sets it back on undo, retiring the assumption
  exactly when the fields it was reasoning about are themselves reverted. A
  *rejected* proposal's assumption is never promoted at all: it simply stays
  `pending_decision = true` forever, which is already "not an active
  hypothesis" without deleting the row — it survives as a historical trace of
  what was proposed and declined, per the issue's own "retained only as
  historical reasoning if useful" framing.

  An assumption recorded with no proposal in the same turn at all — the
  ordinary, and by far the most common, case — gets `source_change_proposal_id
  = null`, `pending_decision = false` by construction: immediately active,
  exactly today's existing behaviour. Nothing about this changes for it.
*/
alter table public.assumptions
  add column if not exists source_change_proposal_id uuid
    references public.change_proposals (id) on delete set null,
  add column if not exists pending_decision boolean not null default false;

create index if not exists assumptions_source_proposal_idx
  on public.assumptions (source_change_proposal_id)
  where source_change_proposal_id is not null;

comment on column public.assumptions.source_change_proposal_id is
  'The connected-change proposal this assumption was inferred alongside in the same turn, if any (T11 review round 5, issue #28). Null for an assumption recorded independently of any proposal.';
comment on column public.assumptions.pending_decision is
  'True while source_change_proposal_id names a still-undecided or rejected proposal: the row exists but must not read as active project truth (T11 review round 5, issue #28). apply_change_proposal clears this on approval/partial approval; undo_change_proposal sets it back on undo. Never cleared for a rejected proposal, since the assumption was never promoted in the first place.';
