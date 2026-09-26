import type React from 'react';
import { I } from './components/ui/Icons';
import { permits } from './policy/model';
import type { PageId } from './api/types';

export type NavItem = {
  id: PageId
  name: string
  ico: React.ReactNode
  /** The heading the item sits under. Absent: a top-level entry with no heading of its own. */
  section?: NavSection
  /** Permissions required to access this page. User needs at least one. Empty = always visible. */
  perms: string[]
}

export type NavSection = 'Sites' | 'People' | 'Access' | 'Compliance'

/** Headings folded shut unless the page on screen is inside them: rarely visited, never urgent. */
export const COLLAPSIBLE: ReadonlySet<NavSection> = new Set(['Compliance'])

// The words are the console's vocabulary — Site, Role, Group, Organization, Member, Org admin — and
// the order is the order an operator works in: plug a site, give people roles on it, check it.
export const NAV: NavItem[] = [
  { id: "dashboard", name: "Home",      ico: I.grid,    perms: [] },
  { id: "sites",     name: "All sites",     ico: I.cube,    section: "Sites", perms: ["admin:read"] },
  { id: "gateway",   name: "Gateway handlers", ico: I.gate, section: "Sites", perms: ["admin:read"] },
  { id: "users",     name: "Users",     ico: I.users,   section: "People", perms: ["admin:read"] },
  { id: "groups",    name: "Groups",    ico: I.group,   section: "People", perms: ["admin:read"] },
  { id: "roles",     name: "Roles & permissions", ico: I.role, section: "Access", perms: ["admin:read"] },
  // "Can X call this route, and why?" — jinbe answers it for platform admins holding write only.
  { id: "accesscheck", name: "Access checker", ico: I.shield, section: "Access", perms: ["admin:write"] },
  { id: "organizations", name: "Organizations", ico: I.globe, perms: ["admin:read"] },
  { id: "apikeys",   name: "API keys",  ico: I.key,     perms: [] },
  { id: "audit",     name: "Audit",     ico: I.audit,   perms: ["admin:read"] },
  { id: "settings",  name: "Settings",  ico: I.cog,     perms: [] },
  // Backup only appears when the chart enabled backup.
  { id: "backup",    name: "Backup",    ico: I.box,     perms: ["admin:read"] },
  { id: "accessreview", name: "Access review", ico: I.check, section: "Compliance", perms: ["admin:read"] },
  { id: "recertification", name: "Recertification", ico: I.clock, section: "Compliance", perms: ["admin:read"] },
  // Delegated org-admin self-service. perms [] — the rail shows it only to somebody who administers
  // an org or may pick any (useMyOrg); the page itself explains an empty list.
  { id: "orgadmin",  name: "My org",    ico: I.globe,   perms: [] },
]

/** The rail entry for a page. Retired ids never reach here: the router redirects them first. */
export function navItemFor(page: PageId): NavItem | undefined {
  return NAV.find((n) => n.id === page)
}

export type NavBlock = { section?: NavSection; items: NavItem[] }

/**
 * The rail as blocks: a run of items under one heading, or a single top-level entry. Built from the
 * list order, so a heading appears where its first item does.
 */
export function navBlocks(items: readonly NavItem[]): NavBlock[] {
  const blocks: NavBlock[] = []
  for (const item of items) {
    const last = blocks[blocks.length - 1]
    if (item.section && last?.section === item.section) last.items.push(item)
    else blocks.push({ section: item.section, items: [item] })
  }
  return blocks
}

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
