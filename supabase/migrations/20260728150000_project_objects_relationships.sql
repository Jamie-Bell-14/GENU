/*
  Semantic relationship foundation (docs/ADAPTIVE_CANVAS_MVP.md §5).

  Identity model: a supertype registry, `project_objects`, holds stable
  identity for every object a relationship may connect. Each concrete table
  (project_fields, assumptions, and later evidence/decisions/documents) keeps
  its own primary key and additionally declares that key as a foreign key into
  the registry — the classic supertype/subtype pattern.

  This is chosen over a polymorphic (target_type, target_id) column because
  ADAPTIVE_CANVAS_MVP §5 forbids unvalidated polymorphic ids: a polymorphic
  column cannot be foreign-keyed, so nothing at the database level would stop a
  relationship pointing at a row that does not exist or belongs to another
  project.

  Cross-project integrity is enforced by composite foreign keys on
  (id, project_id) rather than by application checks alone: relating two
  objects from different projects is rejected by the database.
*/

-- Kinds a relationship endpoint may take. Evidence, decisions and documents
-- are declared now so later migrations add rows, not enum churn.
create type public.project_object_kind as enum (
  'field',
  'assumption',
  'evidence',
  'decision',
  'document'
);

create table public.project_objects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.project_object_kind not null,
  created_at timestamptz not null default now(),
  -- Enables the composite foreign keys below, which is what makes
  -- cross-project references structurally impossible.
  unique (id, project_id)
);

create index project_objects_project_idx on public.project_objects (project_id);

/*
  Register existing rows, then bind each subtype to the registry.

  Registration happens through BEFORE INSERT triggers so services insert a
  field or assumption exactly as before; the registry row is created first and
  the foreign key check then passes. An AFTER DELETE trigger removes the
  registry row so deleting a subtype directly cannot orphan identity.
*/
insert into public.project_objects (id, project_id, kind)
select id, project_id, 'field' from public.project_fields
on conflict (id) do nothing;

insert into public.project_objects (id, project_id, kind)
select id, project_id, 'assumption' from public.assumptions
on conflict (id) do nothing;

create or replace function private.register_project_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_objects (id, project_id, kind)
  values (new.id, new.project_id, tg_argv[0]::public.project_object_kind)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.deregister_project_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.project_objects where id = old.id;
  return old;
end;
$$;

create trigger project_fields_register
  before insert on public.project_fields
  for each row execute function private.register_project_object('field');

create trigger project_fields_deregister
  after delete on public.project_fields
  for each row execute function private.deregister_project_object();

create trigger assumptions_register
  before insert on public.assumptions
  for each row execute function private.register_project_object('assumption');

create trigger assumptions_deregister
  after delete on public.assumptions
  for each row execute function private.deregister_project_object();

-- Bind the subtypes. The composite target also prevents a field being
-- registered under a different project's identity.
alter table public.project_fields
  add constraint project_fields_id_project_uniq unique (id, project_id),
  add constraint project_fields_object_fk
    foreign key (id, project_id)
    references public.project_objects (id, project_id)
    on delete cascade
    deferrable initially deferred;

alter table public.assumptions
  add constraint assumptions_id_project_uniq unique (id, project_id),
  add constraint assumptions_object_fk
    foreign key (id, project_id)
    references public.project_objects (id, project_id)
    on delete cascade
    deferrable initially deferred;

/*
  Relationship vocabulary — closed enum covering the MVP meanings required by
  ADAPTIVE_CANVAS_MVP §5. Deliberately small: it models what the
  problem-exploration and evidence views need, not every future concept.
*/
create type public.relationship_type as enum (
  'possible_cause_of',
  'consequence_of',
  'affects',
  'supports',
  'contradicts',
  'derived_from'
);

create table public.project_relationships (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  from_object_id uuid not null,
  to_object_id uuid not null,
  relation public.relationship_type not null,
  -- Provenance, mirroring the project model: a relationship the AI inferred
  -- must never be indistinguishable from one the user stated.
  origin public.field_origin not null,
  support public.support_state not null default 'hypothesis',
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Both endpoints must belong to this relationship's project.
  constraint project_relationships_from_fk
    foreign key (from_object_id, project_id)
    references public.project_objects (id, project_id)
    on delete cascade,
  constraint project_relationships_to_fk
    foreign key (to_object_id, project_id)
    references public.project_objects (id, project_id)
    on delete cascade,

  constraint project_relationships_no_self_loop
    check (from_object_id <> to_object_id),
  constraint project_relationships_unique_edge
    unique (from_object_id, to_object_id, relation)
);

create index project_relationships_project_idx
  on public.project_relationships (project_id);
create index project_relationships_from_idx
  on public.project_relationships (from_object_id);
create index project_relationships_to_idx
  on public.project_relationships (to_object_id);

create trigger project_relationships_set_updated_at
  before update on public.project_relationships
  for each row execute function private.set_updated_at();

-- Row-Level Security: authorised through the parent project, as with every
-- other project-owned table.
alter table public.project_objects enable row level security;
alter table public.project_relationships enable row level security;

create policy project_objects_select on public.project_objects
  for select to authenticated using (private.is_project_owner(project_id));
create policy project_objects_insert on public.project_objects
  for insert to authenticated with check (private.is_project_owner(project_id));
create policy project_objects_delete on public.project_objects
  for delete to authenticated using (private.is_project_owner(project_id));
-- No UPDATE policy: identity is stable. A registry row is created with its
-- object and removed with it; it is never re-pointed at another project.

create policy project_relationships_select on public.project_relationships
  for select to authenticated using (private.is_project_owner(project_id));
create policy project_relationships_insert on public.project_relationships
  for insert to authenticated with check (private.is_project_owner(project_id));
create policy project_relationships_update on public.project_relationships
  for update to authenticated
  using (private.is_project_owner(project_id))
  with check (private.is_project_owner(project_id));
create policy project_relationships_delete on public.project_relationships
  for delete to authenticated using (private.is_project_owner(project_id));

grant select, insert, delete on public.project_objects to authenticated;
grant select, insert, update, delete on public.project_relationships
  to authenticated;
