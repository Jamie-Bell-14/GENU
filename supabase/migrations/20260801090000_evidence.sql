/*
  Evidence and evidence links (T10, docs/ARCHITECTURE.md §6, DESIGN.md §11).

  Evidence is a low-risk automatic change (DESIGN.md §13.1: "adding cited
  evidence" is explicitly in the auto-apply list), so it is written through the
  ordinary authenticated client under RLS, exactly like `project_fields` and
  `assumptions` — this is not model-mediated project truth and has no business
  going through the elevated turn-completion path T9 built for staged AI
  operations.

  `evidence_links` is deliberately not the polymorphic
  `(target_type, target_id)` pair sketched in the architecture doc. T7–T9
  already built one unified canvas-object id space — `project_fields.id` and
  `assumptions.id` share the same namespace the scene-validation boundary uses
  (`ProjectScope.objectIds`) — so a single `object_id` column, checked against
  that same union at both the RLS layer and the application layer, is the
  smaller design that still preserves referential integrity
  (docs/ADAPTIVE_CANVAS_MVP.md §5: "the smallest database design that
  preserves referential integrity"). Decisions do not exist until T13; a
  `decision_id` column can be added then rather than reintroducing a
  three-way polymorphic reference for a target that has no rows yet.
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
    The research provider's own stable key for the finding this row was built
    from (`src/lib/research/findings.ts`), not a client-supplied value: the
    host looks it up from its own closed catalogue and writes it here. Its
    purpose is idempotency, not display — "add as evidence" pressed twice for
    the same finding and the same project must reuse the one row rather than
    duplicate it (VERTICAL_SLICE_TASKS T10 edge case).
  */
  external_finding_id text not null
    check (char_length(external_finding_id) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (project_id, external_finding_id)
);

create index evidence_project_idx on public.evidence (project_id);

alter table public.evidence enable row level security;

create policy evidence_select on public.evidence
  for select to authenticated using (private.is_project_owner(project_id));
create policy evidence_insert on public.evidence
  for insert to authenticated with check (private.is_project_owner(project_id));
/*
  No update or delete policy. Nothing in T10 edits or removes a recorded
  finding once added — the same reasoning DESIGN.md applies to decisions and
  document versions (history, not a mutable draft), except here by omission of
  a write surface rather than by an explicit append-only design, since evidence
  is not yet a versioned history model. If a future task needs correction or
  removal, that is a deliberate schema change, not a silent RLS gap.
*/

grant select, insert on public.evidence to authenticated;

comment on table public.evidence is
  'Research findings a user has added to their project. is_demo is mandatory so mocked findings can never be mistaken for real ones.';

create table public.evidence_links (
  id uuid primary key default gen_random_uuid(),
  /*
    Duplicated from `evidence.project_id` rather than joined for it. RLS
    policies that would otherwise need a subquery through `evidence` become a
    direct column check, and the same column lets `object_id` be validated
    against the correct project without a join in the `with check` clause below.
  */
  project_id uuid not null references public.projects (id) on delete cascade,
  evidence_id uuid not null references public.evidence (id) on delete cascade,
  object_id uuid not null,
  /*
    What this specific piece of evidence supports and does not support for this
    specific object (VERTICAL_SLICE_SPEC Step 6: "the AI does not claim more
    than the evidence supports"). Stored per link rather than on `evidence`
    itself, because the same finding can honestly support one linked object
    strongly and another only partially — the claim is about the pairing, not
    the source in isolation.
  */
  consequence_summary text not null
    check (char_length(consequence_summary) between 1 and 1000),
  created_at timestamptz not null default now(),
  /*
    Idempotency at the database layer (VERTICAL_SLICE_SPEC T10 edge case:
    "add-as-evidence twice"). A second identical request must not create a
    second row silently — the service layer treats a unique-violation here as
    "already linked" and returns the same summary rather than erroring.
  */
  unique (evidence_id, object_id)
);

create index evidence_links_project_idx on public.evidence_links (project_id);
create index evidence_links_object_idx on public.evidence_links (object_id);

alter table public.evidence_links enable row level security;

create policy evidence_links_select on public.evidence_links
  for select to authenticated using (private.is_project_owner(project_id));
/*
  `object_id` is checked here against the same project, under the same policy
  that already checks ownership — the union of `project_fields` and
  `assumptions` is exactly the id space `ProjectScope.objectIds` validates
  scenes against, so this is the same boundary enforced a second time, at the
  write, in the database (defence in depth, SECURITY_STANDARDS §3.3).
*/
create policy evidence_links_insert on public.evidence_links
  for insert to authenticated
  with check (
    private.is_project_owner(project_id)
    and exists (
      select 1 from public.evidence e
      where e.id = evidence_id and e.project_id = evidence_links.project_id
    )
    and (
      exists (
        select 1 from public.project_fields f
        where f.id = object_id and f.project_id = evidence_links.project_id
      )
      or exists (
        select 1 from public.assumptions a
        where a.id = object_id and a.project_id = evidence_links.project_id
      )
    )
  );

grant select, insert on public.evidence_links to authenticated;

comment on table public.evidence_links is
  'Links evidence to an existing project field or assumption, with the honest consequence of that specific pairing. object_id is validated against both tables at the RLS layer, not only in application code.';
