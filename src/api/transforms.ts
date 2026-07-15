// Single source of truth for jinbe API shape → Kuma UI shape transforms.
//
// Previously these lived (divergently) in both useRbacData.ts and hooks.ts —
// e.g. one jinbeRuleToUi derived `service` by splitting the id, the other by a
// regex strip; only one handled `mfa`/`organizationId`/`stripPath`. Whichever
// path a refactor happened to pick changed behaviour silently (PROBLEM-MAP
// STORE-6). This module is the canonical, richer implementation.

import type { KratosIdentity, JinbeGroup, JinbeAccessRule } from './client';
import type { User, GroupsMap, AccessRule } from './types';

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
  return {
    id: k.id,
    name: k.traits.name || k.traits.email,
    email: k.traits.email,
    groups: k.metadata_admin?.groups || (k as any).groups || [],
    title: '',
    active: k.state === 'active',
    last: k.updated_at ? timeAgo(k.updated_at) : 'never',
    organizationId: k.organization_id,
    ...(mfa !== undefined ? { mfa } : {}),
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

/** Oathkeeper access rule (jinbe shape) → Kuma AccessRule. */
export function jinbeRuleToUi(r: JinbeAccessRule): AccessRule {
  return {
    id: r.id,
    service: r.id.split('-')[0],
    match: { url: r.match.url, methods: r.match.methods },
    authenticators: r.authenticators.map(a => a.handler),
    authorizer: r.authorizer.handler,
    opaUrl: typeof r.authorizer.config === 'object' && r.authorizer.config !== null
      ? (r.authorizer.config as Record<string, string>).remote_json_url || undefined
      : undefined,
    mutators: r.mutators.map(m => m.handler),
    upstream: r.upstream?.url,
    stripPath: r.upstream?.strip_path,
  };
}
