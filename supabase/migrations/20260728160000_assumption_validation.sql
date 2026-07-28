/*
  Assumption presentation data (DESIGN.md §10.3, docs/ADAPTIVE_CANVAS_MVP.md
  §11 D).

  An assumption object must be able to show what is assumed, its current
  support, why it matters, possible alternatives and the recommended
  validation. `alternatives` already existed; `recommended_validation` did not,
  so an assumption could not state how to test it.
*/

alter table public.assumptions
  add column recommended_validation text
    check (char_length(recommended_validation) <= 500);

/*
  `alternatives` was typed `jsonb` with an array default but nothing required
  it to be an array of strings, so a malformed value could reach the renderer.

  Bounding the item count alone still allows ten unbounded strings, so each
  element is length-bounded too: an alternative is a single-line list item in
  the object frame, so 300 characters is the widest value the UI can present
  without becoming a paragraph.

  Check constraints cannot contain subqueries, so the element test lives in an
  immutable helper rather than an inline `not exists (...)`.
*/
create or replace function private.is_string_array(
  value jsonb,
  max_items integer,
  max_item_length integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'array'
     and jsonb_array_length(value) <= max_items
     and not exists (
       select 1
       from jsonb_array_elements(value) as element
       where jsonb_typeof(element) <> 'string'
          or char_length(element #>> '{}') > max_item_length
     );
$$;

alter table public.assumptions
  add constraint assumptions_alternatives_is_string_array
    check (private.is_string_array(alternatives, 10, 300));

comment on column public.assumptions.recommended_validation is
  'How the user could test this assumption. User-facing text; never inferred certainty.';
