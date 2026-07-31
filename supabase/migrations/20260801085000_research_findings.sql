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
  created_at timestamptz not null default now()
);

create index research_findings_project_idx
  on public.research_findings (project_id);

alter table public.research_findings enable row level security;

create policy research_findings_select on public.research_findings
  for select to authenticated using (private.is_project_owner(project_id));
-- No insert/update/delete policy for `authenticated`: only the elevated
-- trusted-writer records a result, exactly like activity_events.

grant select on public.research_findings to authenticated;
grant select, insert on public.research_findings to service_role;

comment on table public.research_findings is
  'The exact result one research pass produced (post-steering), tied to the project and turn that produced it. System-authored only; "Add as evidence" resolves its receipt id here rather than rebuilding from a client-supplied catalogue key.';
