// Single source of truth for jinbe API shape → Kuma UI shape transforms.
//
// Previously these lived (divergently) in both useRbacData.ts and hooks.ts —
// e.g. one jinbeRuleToUi derived `service` by splitting the id, the other by a
// regex strip; only one handled `mfa`/`organizationId`/`stripPath`. Whichever
// path a refactor happened to pick changed behaviour silently (PROBLEM-MAP
// STORE-6). This module is the canonical, richer implementation.

import type { KratosIdentity, JinbeGroup, JinbeAccessRule, SearchedUser } from './client';
import type { User, GroupsMap, AccessRule, AuditEvent } from './types';

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

/** Lightweight search hit → Kuma User row. Search omits mfa/last (it's for
 *  finding people, not the full profile) — those surface on the detail drawer. */
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
    raw: r,
  };
}

/**
 * Normalize a raw audit list (from either /admin/audit/events enriched format
 * or the legacy /admin/rbac/history commit format) into UI AuditEvent rows.
 * Kept as one function so every audit consumer parses identically.
 * (The dual-format handling is tracked for simplification in PROBLEM-MAP API-5.)
 */
export function normalizeAuditEvents(events: any[]): AuditEvent[] {
  return events
    .map((e: any): AuditEvent => {
      // New enriched format (has who/verb/category directly)
      if (e.who || e.verb) {
        return {
          id:             e.id,
          when:           e.when || timeAgo(e.ts || ''),
          ts:             e.ts,
          who:            e.who || '',
          actorName:      e.actorName,
          kind:           e.kind,
          sessionId:      e.sessionId,
          category:       e.category || 'system',
          verb:           e.verb || 'unknown',
          target:         e.target || '',
          status:         e.result === 'applied' ? 'applied' : e.result === 'ok' ? undefined : e.result,
          service:        e.service,
          ip:             e.ip,
          ua:             e.ua,
          reason:         e.reason,
          method:         e.method,
          path:           e.path,
          statusCode:     e.statusCode,
          responseTimeMs: e.responseTimeMs,
        };
      }
      // Old format: { id, event: { type, timestamp, actor: JSON, details: JSON } }
      const ev = e.event || e;
      const actor = typeof ev.actor === 'string' ? JSON.parse(ev.actor) : ev.actor || {};
      const details = typeof ev.details === 'string' ? JSON.parse(ev.details) : ev.details || {};
      const target = typeof ev.target === 'string' ? (ev.target.startsWith('{') ? JSON.parse(ev.target) : { id: ev.target }) : ev.target || {};
      const type = ev.type || '';
      const [cat, verb] = type.includes('.') ? type.split('.', 2) : ['system', type];
      return {
        id:             e.id || ev.id || '',
        when:           timeAgo(ev.timestamp || ''),
        ts:             ev.timestamp,
        who:            actor.email || ev.author || 'system',
        actorName:      actor.name,
        category:       cat,
        verb:           verb,
        target:         ev.message || details.path || target.id || type,
        status:         details.statusCode && details.statusCode >= 400 ? 'failed' : undefined,
        service:        target.type === 'service' ? target.id : undefined,
        ip:             actor.ip || details.ip,
        ua:             actor.ua,
        reason:         details.reason,
        method:         details.method,
        path:           details.path,
        statusCode:     details.statusCode,
        responseTimeMs: details.responseTimeMs,
      };
    })
    .filter((e: AuditEvent) => e.id);
}

/**
 * Fetch + normalize the audit stream: enriched endpoint first, legacy history
 * fallback. Requires an `api`-shaped client injected by the caller to avoid a
 * transforms→client import cycle.
 */
export async function fetchAuditEvents(client: {
  getAuditEvents: (p?: { limit?: number }) => Promise<{ events?: any[] }>;
  getHistory: () => Promise<any[]>;
}): Promise<AuditEvent[]> {
  let events: any[] = [];
  // Track whether EITHER source responded. A swallowed total failure used to
  // return [], which is indistinguishable from a genuinely empty log — an
  // admin investigating a compromise would see a blank, "healthy" audit trail
  // with no hint the fetch failed. So: if neither endpoint responds, throw and
  // let useAudit surface the error. A successful-but-empty response is still a
  // valid empty result (no throw). See audit finding #6.
  let anyOk = false;
  let lastErr: unknown;
  try {
    const raw = await client.getAuditEvents({ limit: 200 });
    events = (raw.events || []).filter((e: any) => e && Object.keys(e).length > 0);
    anyOk = true;
  } catch (e) { lastErr = e; /* enriched endpoint may not exist — try legacy */ }
  if (events.length === 0) {
    try {
      const commits = await client.getHistory();
      events = commits.map((c: any) => ({ ...c }));
      anyOk = true;
    } catch (e) { lastErr = e; /* history may also fail */ }
  }
  if (!anyOk) {
    throw new Error(
      `Audit log unavailable: could not load events from either endpoint (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`,
    );
  }
  return normalizeAuditEvents(events);
}
