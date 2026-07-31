/*
  Evidence (T10, docs/ARCHITECTURE.md §6, DESIGN.md §11,
  docs/ADAPTIVE_CANVAS_MVP.md §5).

  Revised after T10 review round 1 (P0-3): the original version of this
  migration introduced a bespoke `evidence_links` table with its own
  hand-rolled `object_id` union check, bypassing the semantic-relationship
  foundation `20260728150000_project_objects_relationships.sql` already
  built — which explicitly declared `evidence` as a `project_object_kind`
  and reserved `supports`/`contradicts` in `relationship_type` for exactly
  this. That foundation is the smallest-database-design answer
  ADAPTIVE_CANVAS_MVP §5 asks for; a second, parallel link table was not.

  Evidence is now a `project_objects` subtype, registered via the same
  trigger pattern as `project_fields` and `assumptions`
  (`private.register_project_object` / `deregister_project_object`,
  already defined). The connection to whatever it supports is a
  `project_relationships` row, not a bespoke table — so evidence is
  queryable through the same canonical graph `loadProjectRelationships`
  already reads, and T11 can follow it like any other relationship.

  Evidence is written only through `complete_turn`
  (`20260801100000_complete_turn_evidence.sql`), atomically with its
  relationship row and the turn's own answer and terminal state — T10
  review round 1 (P0-2), folded into `complete_turn` itself in review round
  2 (P0-B) so a committed add is exactly as durable and recoverable as any
  other staged write. `authenticated` therefore has no insert grant here at
  all; the only way an `evidence` row can exist is through that one
  transactional path.
*/

create type public.evidence_kind as enum (
  'user_stated',
  'secondary_research',
  'customer_reported',
  'observed',
  'commitment'
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  summary text not null check (char_length(summary) between 1 and 2000),
  source_name text not null check (char_length(source_name) between 1 and 200),
  source_url text check (source_url is null or char_length(source_url) <= 2000),
  retrieved_at timestamptz not null,
  methodology text check (methodology is null or char_length(methodology) <= 1000),
  limitations text check (limitations is null or char_length(limitations) <= 1000),
  kind public.evidence_kind not null,
  /*
    Not nullable, on purpose (PROJECT_PLAN §14, ARCHITECTURE §6, T10 security
    line): demonstration data must always be schema-flagged so it can never
    silently pose as a real finding. The slice's only research is mocked, so
    every row this build writes has `is_demo = true` — but the column does not
    default to that, because a real provider's rows must set it explicitly
    rather than inherit a default meant for the mock.
  */
  is_demo boolean not null,
  /*
    The durable research result this row was built from
    (`research_findings`), not a client-supplied catalogue key (T10 review
    round 1, P0-1). Its purpose is idempotency, not display — "add as
    evidence" pressed twice for the same result and the same project must
    reuse the one row rather than duplicate it (VERTICAL_SLICE_TASKS T10
    edge case).
  */
  source_receipt_id uuid not null references public.research_findings (id),
  created_at timestamptz not null default now(),
  unique (project_id, source_receipt_id),
  -- Enables the composite foreign key below (the supertype/subtype pattern
  -- `project_objects_relationships.sql` already established).
  unique (id, project_id)
);

create index evidence_project_idx on public.evidence (project_id);

alter table public.evidence enable row level security;

create policy evidence_select on public.evidence
  for select to authenticated using (private.is_project_owner(project_id));
/*
  No insert, update or delete policy, and no grant beyond select. Every
  evidence row is created by `complete_turn` (security definer), which
  authorises its own caller — see that migration's header. A direct-insert
  grant here would just be a second, unauthorised write path alongside it.
*/

grant select on public.evidence to authenticated;

comment on table public.evidence is
  'Research findings a user has added to their project. is_demo is mandatory so mocked findings can never be mistaken for real ones. Written only by complete_turn(), atomically with its project_relationships link and the turn''s own answer.';

-- Registers evidence in the stable identity registry, exactly like
-- project_fields and assumptions (20260728150000_project_objects_relationships.sql).
create trigger evidence_register
  before insert on public.evidence
  for each row execute function private.register_project_object('evidence');

create trigger evidence_deregister
  after delete on public.evidence
  for each row execute function private.deregister_project_object();

alter table public.evidence
  add constraint evidence_object_fk
    foreign key (id, project_id)
    references public.project_objects (id, project_id)
    on delete cascade
    deferrable initially deferred;
