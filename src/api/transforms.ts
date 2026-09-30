// Single source of truth for jinbe API shape → Kuma UI shape transforms.
//
// Previously these lived (divergently) in both useRbacData.ts and hooks.ts —
// only one handled `mfa`/`organizationId`. Whichever
// path a refactor happened to pick changed behaviour silently (PROBLEM-MAP
// STORE-6). This module is the canonical, richer implementation.

import type { KratosIdentity, JinbeGroup, SearchedUser } from './client';
import type { User, GroupsMap } from './types';

/** Relative "x ago" formatting for updated_at / audit timestamps. */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * The organisations an identity belongs to, from whoever owns them.
 *
 * jinbe answers `organizations` from the records it owns — the effective set, primary included. A
 * backend that does not own membership omits the field, and then what was written on the identity
 * (`metadata_admin.organizations`) is the best available answer. Absent and empty are different
 * answers: `[]` states that somebody belongs to nothing, so it must NOT fall through.
 *
 * Exported because the screen that EDITS membership has to start from the same answer the table
 * shows. Reading the identity while the truth lived elsewhere showed an empty list to people who
 * belong to three — and that screen saves what it shows.
 */
export function membershipsOf(
  k: { organizations?: unknown; metadata_admin?: { organizations?: unknown } | null },
): string[] {
  if (Array.isArray(k.organizations)) return k.organizations as string[];
  if (Array.isArray(k.metadata_admin?.organizations)) return k.metadata_admin!.organizations as string[];
  return [];
}

/** Kratos identity (enriched by jinbe) → Kuma User row. */
export function kratosToUser(k: KratosIdentity): User {
  // jinbe's enriched users response carries credential presence as
  // top-level `mfa: boolean`. The raw Kratos identity may also have a
  // `credentials` object when listIdentities was called with
  // include_credential — fall back to scanning that.
  const enriched = k as KratosIdentity & {
    mfa?: boolean
    credentials?: Record<string, unknown>
  };
  let mfa: boolean | undefined = enriched.mfa;
  if (mfa === undefined && enriched.credentials) {
    // Kratos auto-creates credentials.webauthn with just a `user_handle`
    // when the identity schema declares webauthn as an identifier — even
    // though no security key has actually been registered. The presence
    // of the credential key is therefore not a reliable enrollment
    // signal. Look inside each credential's config for the real artefact
    // a second-factor flow actually writes:
    //   - totp:          config.totp_url           (set on enrol)
    //   - webauthn:      config.credentials[]      (registered keys; user_handle alone doesn't count)
    //   - lookup_secret: config.recovery_codes[]   (generated codes)
    const c = enriched.credentials as Record<string, { config?: Record<string, unknown> } | undefined>;
    const totpReg     = !!c.totp?.config?.totp_url;
    const webauthnReg = Array.isArray((c.webauthn?.config as any)?.credentials) &&
                        ((c.webauthn?.config as any).credentials.length > 0);
    const lookupReg   = Array.isArray((c.lookup_secret?.config as any)?.recovery_codes) &&
                        ((c.lookup_secret?.config as any).recovery_codes.length > 0);
    if (totpReg || webauthnReg || lookupReg) mfa = true;
    else if (Object.keys(c).length > 0) mfa = false;
  }
  const organizations = membershipsOf(k);
  return {
    id: k.id,
    name: k.traits.name || k.traits.email,
    email: k.traits.email,
    // The ENFORCED memberships first, which jinbe resolves from the store the engine reads, and the
    // Kratos copy only when it answers none. It was the other way round, so a membership held only
    // where it decides was invisible — and the drawer that edits it seeds from this, so the screen
    // offered to remove a group it was not showing.
    groups: (k as any).groups || k.metadata_admin?.groups || [],
    title: '',
    active: k.state === 'active',
    last: k.updated_at ? timeAgo(k.updated_at) : 'never',
    organizationId: k.organization_id,
    organizations,
    ...(mfa !== undefined ? { mfa } : {}),
  };
}

/** Lightweight search hit → Kuma User row. jinbe enriches hits with real 2FA
 *  status (`mfa`); `last` still surfaces only on the detail drawer. */
export function searchedToUser(s: SearchedUser): User {
  return {
    id: s.id,
    name: s.name || s.email,
    email: s.email,
    groups: s.groups,
    title: '',
    active: s.active,
    last: '',
    organizationId: s.organizationId ?? undefined,
    ...(s.mfa !== undefined ? { mfa: s.mfa } : {}),
  };
}

/** jinbe groups list → { name → services map } lookup. */
export function jinbeGroupsToMap(groups: JinbeGroup[]): GroupsMap {
  const map: GroupsMap = {};
  for (const g of groups) {
    map[g.name] = g.services;
  }
  return map;
}
