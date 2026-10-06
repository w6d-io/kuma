// The sections of a snapshot (jinbe bundle-format.ts), in the order the dialog lists them. The four
// RBAC ones are in every file; the rest only in the files that carry them (format 2, or a format-1
// file exported after org entitlements).
export const SECTIONS = [
  { id: 'services', label: 'Services' },
  { id: 'groups', label: 'Groups' },
  { id: 'roles', label: 'Roles (with org roles)' },
  { id: 'routeMaps', label: 'Route maps' },
  { id: 'orgSites', label: 'Organization → site entitlements' },
  { id: 'orgAssignments', label: 'People’s organization roles' },
  { id: 'directGrants', label: 'People’s direct grants' },
  { id: 'sites', label: 'Site intents and their versions' },
  { id: 'settings', label: 'Platform settings' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'signup', label: 'Sign-up organizations and domain claims' },
  { id: 'metadata', label: 'Service and group descriptions' },
] as const;
export type SectionId = (typeof SECTIONS)[number]['id'];

type Json = Record<string, unknown>;
const size = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);
const field = (v: unknown, key: string) => (v && typeof v === 'object' ? (v as Json)[key] : undefined);

/** How many entries each section of the file holds; a section the file lacks is absent. */
export function countsOf(rbac: Json): Partial<Record<SectionId, number>> {
  const out: Partial<Record<SectionId, number>> = {
    services: size(rbac.services), groups: size(rbac.groups), roles: size(rbac.roles), routeMaps: size(rbac.routeMaps),
  };
  if (rbac.orgSites || rbac.orgServiceMap) out.orgSites = size(rbac.orgSites ?? rbac.orgServiceMap);
  if (rbac.orgAssignments) out.orgAssignments = size(rbac.orgAssignments);
  if (rbac.directGrants) out.directGrants = size(rbac.directGrants);
  if (rbac.sites) out.sites = size(field(rbac.sites, 'records'));
  if (rbac.settings) out.settings = size(rbac.settings);
  if (rbac.organizations) out.organizations = size(field(rbac.organizations, 'registry'));
  if (rbac.signup) out.signup = size(field(rbac.signup, 'orgSites')) + size(field(rbac.signup, 'domains'));
  if (rbac.metadata) out.metadata = size(field(rbac.metadata, 'services')) + size(field(rbac.metadata, 'groups'));
  return out;
}

export interface PendingFile {
  bundle: { version: string; rbac: Json };
  name: string;
  counts: Partial<Record<SectionId, number>>;
  /** Gateway rules in a format-1 file: never restored. */
  rules: number;
}

/** The uploaded file read as a snapshot, or the reason it is not one. */
export function readSnapshot(text: string, name: string): PendingFile | string {
  let bundle: unknown;
  try { bundle = JSON.parse(text); } catch { return 'Not valid JSON'; }
  const version = field(bundle, 'version');
  const rbac = field(bundle, 'rbac');
  if (!version || !rbac || typeof rbac !== 'object') return 'Missing version or rbac fields';
  return { bundle: { version: String(version), rbac: rbac as Json }, name, counts: countsOf(rbac as Json), rules: size(field(rbac, 'oathkeeperRules')) };
}

export const availableSections = (file: PendingFile) => SECTIONS.filter((s) => file.counts[s.id] !== undefined);
