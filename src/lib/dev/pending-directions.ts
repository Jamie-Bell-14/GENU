/**
 * In-memory steering handover for the development-only turn endpoint.
 *
 * The real route hands directions between requests through the database, which
 * is what works across server instances. The dev route has no database at all,
 * so it keeps directions in module state instead. That is acceptable here and
 * only here: the routes using it return 404 in production, and nothing outside
 * `/api/dev/*` imports this file.
 */
const pending = new Map<string, string[]>();

const MAX_TURNS_TRACKED = 20;

/**
 * Registers a turn this endpoint actually started. The direction endpoint
 * accepts a turn id only if it appears here, mirroring the real route's rule
 * that a direction must belong to a turn of the authorised project.
 */
export function openDevTurn(turnId: string): void {
  // Bounded so a long-running dev server cannot accumulate turns without end.
  if (pending.size >= MAX_TURNS_TRACKED) {
    const oldest = pending.keys().next().value;
    if (oldest) pending.delete(oldest);
  }
  pending.set(turnId, []);
}

export function isDevTurn(turnId: string): boolean {
  return pending.has(turnId);
}

/** Marks a turn finished: it can no longer accept direction. */
export function closeDevTurn(turnId: string): void {
  pending.delete(turnId);
}

export function addPendingDirection(turnId: string, note: string): boolean {
  const notes = pending.get(turnId);
  if (!notes) return false;
  notes.push(note);
  return true;
}

/** Returns and clears the directions added since the last call. */
export function takePendingDirections(turnId: string): string | null {
  const notes = pending.get(turnId);
  if (!notes || notes.length === 0) return null;
  pending.set(turnId, []);
  return notes.join("\n");
}

/** Test seam: the module holds process state, so tests must be able to reset. */
export function resetDevTurns(): void {
  pending.clear();
}
