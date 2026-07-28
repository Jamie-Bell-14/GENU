/**
 * Planning navigation (DESIGN.md §3.2): the stable planning structure.
 * Until discovery produces content, areas carry honest status text rather
 * than dead links — nothing here pretends to be clickable.
 */
const AREAS: ReadonlyArray<{ name: string; empty: string }> = [
  { name: "Opportunity", empty: "Nothing captured yet" },
  { name: "Customer", empty: "Nothing captured yet" },
  { name: "Product", empty: "Nothing captured yet" },
  { name: "Commercial", empty: "Nothing captured yet" },
  { name: "Build", empty: "Nothing captured yet" },
  { name: "History", empty: "No decisions yet" },
];

export function PlanningNav() {
  return (
    <nav
      aria-label="Planning"
      className="border-edge-subtle bg-surface-primary flex w-(--workspace-nav-width) shrink-0 flex-col gap-1 overflow-y-auto border-r p-3"
    >
      <ul className="flex flex-col gap-0.5">
        {AREAS.map((area) => (
          <li key={area.name} className="rounded-md px-2 py-1.5">
            <span className="block text-sm font-medium">{area.name}</span>
            <span className="text-fg-tertiary block text-xs">{area.empty}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
