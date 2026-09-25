import type { OrgGrants } from '../api/orgAccess';

/**
 * The org layer as an org admin edits it: people × the groups they may hand out in their org.
 *
 * A grant here only counts on that org's routes and never takes away what a person holds on the
 * sites through their own groups, so the page edits one org's map and nothing else.
 */

export interface GrantColumn {
  name: string;
  /** False for a group somebody already holds here that the caller may not hand out: shown, not editable. */
  grantable: boolean;
}

/** What may be granted, then anything already held that may not — visible, so it cannot vanish unnoticed. */
export function columnsFor(assignable: string[], saved: OrgGrants): GrantColumn[] {
  const held = new Set(Object.values(saved).flat());
  const extra = [...held].filter((g) => !assignable.includes(g)).sort();
  return [
    ...[...assignable].sort().map((name) => ({ name, grantable: true })),
    ...extra.map((name) => ({ name, grantable: false })),
  ];
}

export function toggleGrant(draft: OrgGrants, email: string, group: string): OrgGrants {
  const cur = draft[email] ?? [];
  return { ...draft, [email]: cur.includes(group) ? cur.filter((g) => g !== group) : [...cur, group] };
}

export function sameGroups(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = new Set(a ?? []);
  const y = new Set(b ?? []);
  return x.size === y.size && [...x].every((g) => y.has(g));
}

export function changedMembers(saved: OrgGrants, draft: OrgGrants): string[] {
  return Object.keys(draft).filter((email) => !sameGroups(saved[email], draft[email]));
}

/**
 * Whether the rail offers "My org", and whether its picker lists every org. An org admin sees the
 * orgs they administer; somebody who may read every org picks from all of them; anybody else has
 * nothing to administer, so the entry is not shown.
 */
export function myOrgVisibility(input: { administered: string[]; mayReadAll: boolean }): { show: boolean; pickAny: boolean } {
  if (input.mayReadAll) return { show: true, pickAny: true };
  return { show: input.administered.length > 0, pickAny: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Add an existing member" takes their email or their user id; which one decides how they are found. */
export function readMemberInput(raw: string): { kind: 'id'; id: string } | { kind: 'email'; email: string } | { kind: 'invalid' } {
  const v = raw.trim().toLowerCase();
  if (UUID.test(v)) return { kind: 'id', id: v };
  if (/^[^\s@]+@[^\s@]+$/.test(v)) return { kind: 'email', email: v };
  return { kind: 'invalid' };
}
