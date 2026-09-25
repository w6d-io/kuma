import type React from 'react';
import { I } from './components/ui/Icons';
import { permits } from './policy/model';
import type { PageId } from './api/types';

export type NavItem = {
  id: PageId
  name: string
  ico: React.ReactNode
  section: string
  /** Permissions required to access this page. User needs at least one. Empty = always visible. */
  perms: string[]
}

export const NAV: NavItem[] = [
  { id: "dashboard", name: "Overview",  ico: I.grid,    section: "Platform", perms: [] },
  { id: "users",     name: "Users",     ico: I.users,   section: "Platform", perms: ["admin:read"] },
  { id: "groups",    name: "Groups",    ico: I.group,   section: "Platform", perms: ["admin:read"] },
  // What protects each API and who can reach it, read from the objects the engines load. It replaced
  // a "Services" workspace that edited a registry nothing reads — so it shows and does not offer.
  { id: "apis",      name: "APIs",      ico: I.service, section: "Policy",   perms: ["admin:read"] },
  { id: "organizations", name: "Organizations", ico: I.globe, section: "Policy", perms: ["admin:read"] },
  // Org-scoped: jinbe checks the caller administers the organization, so an org admin without
  // platform read reaches it too. perms [] — the page says so when an org refuses.
  // "Can X call this route, and why?" — jinbe answers it for platform admins holding write only.
  { id: "accesscheck", name: "Access checker", ico: I.shield, section: "Policy", perms: ["admin:write"] },
  { id: "apikeys",   name: "API keys",  ico: I.key,     section: "Policy",   perms: [] },
  { id: "audit",     name: "Audit log", ico: I.audit,   section: "Changes",  perms: ["admin:read"] },
  { id: "accessreview", name: "Access review", ico: I.shield, section: "Changes", perms: ["admin:read"] },
  { id: "recertification", name: "Recertification", ico: I.check, section: "Changes", perms: ["admin:read"] },
  // Backup tab only appears when the chart enabled backup (see filter below).
  { id: "backup",    name: "Backup",    ico: I.box,     section: "Changes",  perms: ["admin:read"] },
  { id: "settings",  name: "Settings",  ico: I.cog,     section: "Changes",  perms: [] },
  // Delegated org-admin self-service. perms [] — the rail shows it only to somebody who administers
  // an org or may pick any (useMyOrg); the page itself explains an empty list.
  { id: "orgadmin",  name: "My org",    ico: I.globe,   section: "My org",   perms: [] },
]

/**
 * Whether this session admits any of the permissions a screen asks for.
 *
 * Through the model's own coverage rule rather than an exact match, so `admin:write` admits
 * `admin.membership:write` here exactly as it does at the engine. The `*` shortcut is gone with the
 * wildcard: no role carries one, and treating it as a pass let the console open screens on a
 * permission the model does not define.
 */
export function hasAnyPerm(userPerms: string[] | undefined, required: string[]): boolean {
  if (required.length === 0) return true
  return required.some((r) => permits(userPerms, r))
}
