import { OWNER_ROLE, type OrgRole } from '../api/orgAccess';

/**
 * One organization's roles as its admins edit them: members × the org roles the org may hold.
 *
 * A role assigned here only counts on this org's routes and never touches what a person holds on the
 * platform through their groups, so the page edits one org's assignments and nothing else. Keyed by
 * identity id, as jinbe stores them (an address can change, the subject cannot).
 */

/** member id → the org roles assigned to them here (`svc:role`). */
export type MemberRoles = Record<string, string[]>;

export interface RoleColumn {
  role: string;
  permissions: string[];
  /** False for a role the caller may not hand out, or one held here the org no longer offers: shown, not addable. */
  assignable: boolean;
  /** Held by somebody here, but not among the org's roles any more (its site dropped the org, or the role). */
  retired: boolean;
}

/** The org's roles, then anything already held that it no longer offers — visible, so it cannot vanish unnoticed. */
export function columnsFor(roles: readonly OrgRole[], saved: MemberRoles): RoleColumn[] {
  const known = new Set(roles.map((r) => r.role));
  const held = new Set(Object.values(saved).flat());
  const retired = [...held].filter((r) => !known.has(r)).sort();
  return [
    ...[...roles].sort((a, b) => a.role.localeCompare(b.role)).map((r) => ({ role: r.role, permissions: r.permissions, assignable: r.assignable, retired: false })),
    ...retired.map((role) => ({ role, permissions: [], assignable: false, retired: true })),
  ];
}

export function toggleRole(draft: MemberRoles, member: string, role: string): MemberRoles {
  const cur = draft[member] ?? [];
  return { ...draft, [member]: cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role] };
}

export function sameSet(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = new Set(a ?? []);
  const y = new Set(b ?? []);
  return x.size === y.size && [...x].every((g) => y.has(g));
}

export function changedMembers(saved: MemberRoles, draft: MemberRoles): string[] {
  return Object.keys(draft).filter((id) => !sameSet(saved[id], draft[id]));
}

/** The sites this org's roles come from: the org is entitled to them by each site's intent. jinbe's own are not a site. */
export function entitledSites(roles: readonly OrgRole[]): string[] {
  return [...new Set(roles.map((r) => r.role.split(':')[0]).filter((svc) => svc && svc !== 'jinbe'))].sort();
}

/** The members holding the owner role here. */
export function ownersOf(byId: MemberRoles): string[] {
  return Object.entries(byId).filter(([, roles]) => roles.includes(OWNER_ROLE)).map(([id]) => id).sort();
}

/** `payroll:editor` → `editor` on `payroll`; jinbe's roles read as plain names. */
export function roleLabel(role: string): { name: string; site: string | null } {
  const [svc, name] = role.split(':');
  return name === undefined ? { name: role, site: null } : { name, site: svc === 'jinbe' ? null : svc };
}

/**
 * Whether the rail offers "My org", and whether its picker lists every org. Somebody holding an org
 * permission somewhere sees those orgs; somebody who may list every org picks from all of them;
 * anybody else has nothing to look at, so the entry is not shown.
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
