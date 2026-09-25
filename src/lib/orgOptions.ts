/**
 * Organisations as a person picks them: by name, with the identifier as the tiebreaker.
 *
 * The catalogue is whatever the caller may see. An id the catalogue does not know — a membership
 * written before an organisation was renamed away, or one outside the caller's view — is still
 * listed, by its id, so a picker never silently drops the value it was given.
 */
export interface OrgOption {
  id: string;
  label: string;
  known: boolean;
}

export function orgOptions(
  catalog: { id: string; name?: string }[],
  keep: (string | undefined | null)[] = [],
): OrgOption[] {
  const byId = new Map<string, OrgOption>();
  for (const o of catalog) {
    if (!o.id) continue;
    byId.set(o.id, { id: o.id, label: o.name?.trim() || o.id, known: true });
  }
  for (const id of keep) {
    if (id && !byId.has(id)) byId.set(id, { id, label: id, known: false });
  }
  return [...byId.values()].sort((a, b) =>
    a.known === b.known ? a.label.localeCompare(b.label) : a.known ? -1 : 1,
  );
}

/** What to call one organisation on screen. */
export function orgLabel(id: string, catalog: { id: string; name?: string }[]): string {
  return catalog.find((o) => o.id === id)?.name?.trim() || id;
}
