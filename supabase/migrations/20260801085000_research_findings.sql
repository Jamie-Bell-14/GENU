/*
  Durable research-result receipts (T10 review round 1, P0-1).

  A research pass is stateful — steering ("Focus on England and prioritise
  official sources") genuinely changes what the provider produces, so the
  exact result a person saw on the canvas cannot be re-derived later from a
  static catalogue key. "Add as evidence" is a *later* turn's action, and
  without a durable record of what research actually produced, that later
  turn had nothing but a client-supplied id naming a fixed scripted template —
  which let a client claim any known finding, discarded whatever steering had
  actually applied, and recorded a retrieval time describing when evidence
  was added rather than when research produced it.

  This table is the fix: the exact produced result, tied to the project and
  the turn that produced it, written once and never edited.

  Trust model, identical to `activity_events` (docs/SECURITY_STANDARDS §11.2):
  system-authored, never client-authored. `authenticated` may only read its
  own project's rows; every insert goes through the elevated trusted-writer,
  which is what makes "the server proves this project produced this result"
  actually true rather than merely conventional.

  Revised after T10 review round 2 (P0-A): the receipt now also carries the
  object research was actually run against (`focal_object_id`) and the
  unavailable-source outcomes and applied steering that were part of the
  displayed result. Without the first, "Add as evidence" had nothing but a
  *later* turn's freshly recomputed default focus to link against — which is
  not necessarily the object this research concerned at all. Without the
  second and third, that part of what the user saw simply vanished from the
  durable record the moment the session state holding it was gone.
*/
create table public.research_findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Correlates to the turn whose research produced this result. No foreign
  -- key: activity_events.turn_id is the same kind of correlator, not a
  -- reference that must always resolve to a live row.
  turn_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  key_finding text not null check (char_length(key_finding) between 1 and 2000),
  why_it_matters text not null check (char_length(why_it_matters) between 1 and 1000),
  -- Structured chart data and the source list, exactly as produced — never
  -- re-derived from a template at add-evidence time. Bounded generously
  -- rather than tightly: this is system-authored, not user input, so the
  -- check is a sanity bound against a broken caller, not an attack surface.
  visualisation jsonb not null
    check (jsonb_typeof(visualisation) = 'object' and pg_column_size(visualisation) <= 8192),
  sources jsonb not null
    check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) <= 8192),
  methodology text not null check (char_length(methodology) between 1 and 1000),
  limitations text not null check (char_length(limitations) between 1 and 1000),
  retrieved_at timestamptz not null,
  is_demo boolean not null,
  conflicting boolean not null,
  /*
    The object this pass was actually run against, so a later "Add as
    evidence" links to what was researched rather than whatever object
    happens to be the default focus by the time that later turn runs
    (T10 review round 2, P0-A). Nullable: research with no object in focus
    (an empty project) produces a receipt nothing can honestly be added
    against. `on delete set null` rather than cascading the receipt away —
    the receipt is a record of what happened and outlives the object; it
    simply becomes un-addable once its target is gone.
  */
  focal_object_id uuid,
  -- Sources this pass reported unavailable, in the same shape streamed to
  -- the client, so that part of what the user saw is not lost the moment
  -- session state holding it is (T10 review round 2, P0-A).
  unavailable_sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(unavailable_sources) = 'array' and pg_column_size(unavailable_sources) <= 8192),
  -- Steering notes the provider actually applied to this pass (never ones it
  -- reported `requires_restart` for), so which direction affected the result
  -- stays identifiable after the fact.
  applied_directions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(applied_directions) = 'array' and pg_column_size(applied_directions) <= 4096),
  created_at timestamptz not null default now()
);

create index research_findings_project_idx
  on public.research_findings (project_id);

alter table public.research_findings
  add constraint research_findings_focal_fk
    foreign key (focal_object_id, project_id)
    references public.project_objects (id, project_id)
    /*
      Column-specific SET NULL (Postgres 15+): only `focal_object_id` is
      cleared when its target is deleted. A plain `on delete set null` on a
      composite key nulls *every* referencing column, including
      `project_id` — which is `not null` here, so that would have raised
      rather than cleared the reference, discovered by
      supabase/tests/evidence-rls.test.ts.
    */
    on delete set null (focal_object_id);

alter table public.research_findings enable row level security;

create policy research_findings_select on public.research_findings
  for select to authenticated using (private.is_project_owner(project_id));
-- No insert/update/delete policy for `authenticated`: only the elevated
-- trusted-writer records a result, exactly like activity_events.

grant select on public.research_findings to authenticated;
grant select, insert on public.research_findings to service_role;

comment on table public.research_findings is
  'The exact result one research pass produced (post-steering), tied to the project and turn that produced it. System-authored only; "Add as evidence" resolves its receipt id here rather than rebuilding from a client-supplied catalogue key.';
