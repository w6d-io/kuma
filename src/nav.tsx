import type React from 'react';
import { I } from './components/ui/Icons';
import { holdsAny, type HeldSession } from './policy/model';
import type { PlatformPermission } from './policy/catalog';
import type { PageId } from './api/types';

export type NavItem = {
  id: PageId
  name: string
  ico: React.ReactNode
  /** The heading the item sits under. Absent: a top-level entry with no heading of its own. */
  section?: NavSection
  /** Catalogue permissions that open this page. User needs at least one. Empty = always visible. */
  perms: PlatformPermission[]
}

export type NavSection = 'Sites' | 'People' | 'Access' | 'Compliance'

/** Headings folded shut unless the page on screen is inside them: rarely visited, never urgent. */
export const COLLAPSIBLE: ReadonlySet<NavSection> = new Set(['Compliance'])

// The words are the console's vocabulary — Site, Role, Group, Organization, Member, Org admin — and
// the order is the order an operator works in: plug a site, give people roles on it, check it.
export const NAV: NavItem[] = [
  { id: "dashboard", name: "Home",      ico: I.grid,    perms: [] },
  { id: "sites",     name: "All sites",     ico: I.cube,    section: "Sites", perms: ["sites:read"] },
  { id: "gateway",   name: "Gateway handlers", ico: I.gate, section: "Sites", perms: ["gateway:read"] },
  { id: "users",     name: "Users",     ico: I.users,   section: "People", perms: ["users:read"] },
  { id: "groups",    name: "Groups",    ico: I.group,   section: "People", perms: ["groups:read"] },
  { id: "roles",     name: "Roles & permissions", ico: I.role, section: "Access", perms: ["groups:read"] },
  // "Can X call this route, and why?"
  { id: "accesscheck", name: "Access checker", ico: I.shield, section: "Access", perms: ["access:check"] },
  { id: "organizations", name: "Organizations", ico: I.globe, perms: ["orgs:read"] },
  { id: "apikeys",   name: "API keys",  ico: I.key,     perms: [] },
  // Your own keys (MCP). perms [] — the rail shows it only where jinbe serves personal keys
  // (usePersonalKeysEnabled): a 404 there means the platform has them switched off.
  { id: "connections", name: "Connections & keys", ico: I.sparkle, perms: [] },
  { id: "audit",     name: "Audit",     ico: I.audit,   perms: ["audit:read"] },
  { id: "settings",  name: "Settings",  ico: I.cog,     perms: [] },
  // Download and restore from a file work everywhere; S3 snapshots where the chart turned them on.
  { id: "backup",    name: "Backup & restore", ico: I.box, perms: ["policy.bundle:read"] },
  { id: "accessreview", name: "Access review", ico: I.check, section: "Compliance", perms: ["access:read"] },
  { id: "grants", name: "Direct grants", ico: I.key, section: "Compliance", perms: ["users.grants:read"] },
  { id: "recertification", name: "Recertification", ico: I.clock, section: "Compliance", perms: ["recert:read"] },
  // One organization from the inside. perms [] — the rail shows it only to somebody who holds an org
  // permission somewhere, or may list every org (useMyOrg); the page itself explains an empty list.
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

/** Whether this session holds any of the permissions a screen asks for: exact catalogue names. */
export function hasAnyPerm(session: HeldSession, required: readonly PlatformPermission[]): boolean {
  return holdsAny(session, required)
}
