import { I } from '../../components/ui';
import type { BadgeTone } from '../../components/ui';
import type { AuditEvent, AuditSummary } from '../../api/types';

// Audit timestamps are ISO/UTC. Render + bucket them in the operator's LOCAL
// time — a UTC string-slice showed the wrong clock time and could file an event
// under the wrong day. (Phase 1 will hoist these into one shared date util.)
export const localDayKey = (t?: string): string => {
  if (!t) return "";
  const d = new Date(t);
  return isNaN(+d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const localTime = (t?: string): string => {
  if (!t) return "";
  const d = new Date(t);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// Grafana base for per-event trace deep-links (correlate by sessionId/actor,
// contract D3). Runtime-injected like __API_BASE__; empty = no link rendered.
export function grafanaTraceUrl(e: AuditEvent): string | null {
  const base = (window as unknown as { __GRAFANA_URL__?: string }).__GRAFANA_URL__?.replace(/\/$/, '');
  if (!base || base.startsWith('${')) return null; // unset / un-substituted placeholder
  const sid = e.sessionId;
  const params = new URLSearchParams();
  if (sid) params.set('var-sessionId', sid);
  if (e.who && e.who !== 'anon' && e.who !== 'system') params.set('var-actor', e.who);
  return `${base}/d/auth-audit?${params.toString()}`;
}

export const AUDIT_CATS: Record<string, { label: string; icon: keyof typeof I }> = {
  auth: { label: "Auth", icon: "key" },
  access: { label: "Access", icon: "shield" },
  rbac: { label: "RBAC", icon: "users" },
  policy: { label: "Policy", icon: "file" },
  service: { label: "Service", icon: "cube" },
  route: { label: "Route", icon: "route" },
  secret: { label: "Secret", icon: "lock" },
  directory: { label: "Directory", icon: "users" },
  bundle: { label: "Bundle", icon: "box" },
  system: { label: "System", icon: "cog" },
};

export function verbTone(v: string): BadgeTone {
  if (["deny", "fail", "revoke", "delete"].includes(v)) return "danger";
  if (["allow", "login", "create", "add", "commit"].includes(v)) return "success";
  if (["logout", "expire", "revert"].includes(v)) return "warning";
  return "neutral";
}

// HTTP status → a text-colour class (2xx success, 3xx info, 4xx warning, 5xx danger).
export function statusToneClass(code?: number): string {
  if (!code) return "";
  if (code < 300) return "text-success";
  if (code < 400) return "audit-text-info";
  if (code < 500) return "text-warning";
  return "text-danger";
}

// ─── Shared risk classifier (Part E) ────────────────────────────────────────
// riskOf is DISPLAY-ONLY refinement. The `?risk=high` gate and the hero are
// server-authoritative via emit-time `severity` + `changes.flags` ([P2-3]); this
// only sharpens the label/badge for a row already in hand. Severity is expressed
// strictly through semantic tokens (danger / warning) — NEVER accent.
export interface RiskInfo { level: 'critical' | 'warn' | 'none'; label: string; tone: 'danger' | 'warning' | '' }

export const RISK_FLAG_LABEL: Record<string, string> = {
  grants_super_admin: 'grants super-admin',
  wildcard_permission: 'grants wildcard (*)',
  opened_to_public: 'opened to the public',
  auth_disabled: 'authentication disabled',
};

export function riskOf(e: AuditEvent): RiskInfo {
  const flags = e.changes?.flags ?? [];
  const sev = (e.severity || '').toLowerCase();
  const cat = (e.category || '').toLowerCase();
  const verb = (e.verb || '').toLowerCase();
  const target = (e.target || '').toLowerCase();
  const isFail = e.status === 'failed' || verb === 'fail' || verb === 'deny';

  // ── CRITICAL (P0) ─────────────────────────────────────────────
  // 1) An authoritative critical flag on the before→after diff.
  const critFlag = flags.find(f => f in RISK_FLAG_LABEL);
  if (critFlag) return { level: 'critical', label: RISK_FLAG_LABEL[critFlag], tone: 'danger' };
  // 2) Server says critical/high (spans history; client just labels it).
  if (sev === 'critical' || sev === 'high')
    return { level: 'critical', label: shortLabel(e) || 'high-risk change', tone: 'danger' };
  // 3) A wildcard grant surfaced in the diff even without a flag.
  if ((e.changes?.added ?? []).includes('*'))
    return { level: 'critical', label: 'grants wildcard (*)', tone: 'danger' };
  // 4) Bundle import / restore — mass rewrite / exfil-adjacent.
  if ((cat === 'bundle' || target.includes('bundle') || target.includes('backup'))
      && ['import', 'restore', 'apply'].includes(verb) && !isFail)
    return { level: 'critical', label: verb === 'restore' ? 'config restored' : 'bundle imported', tone: 'danger' };

  // ── WARN (P1/P2) ──────────────────────────────────────────────
  if (sev === 'warn' || sev === 'warning' || sev === 'medium')
    return { level: 'warn', label: shortLabel(e) || 'review', tone: 'warning' };
  // MFA disabled / login without a second factor.
  if (e.mfa === false && (cat === 'auth' || verb === 'login' || verb === 'mfa'))
    return { level: 'warn', label: 'no second factor', tone: 'warning' };
  // API-key / secret issuance.
  if (cat === 'secret' && ['create', 'issue', 'add', 'rotate'].includes(verb) && !isFail)
    return { level: 'warn', label: 'key issued', tone: 'warning' };
  // Privileged delete.
  if (verb === 'delete' && ['rbac', 'service', 'route', 'secret', 'access', 'directory'].includes(cat) && !isFail)
    return { level: 'warn', label: 'privileged delete', tone: 'warning' };
  // Denials (recon signal) on a privileged surface.
  if (isFail && (cat === 'access' || cat === 'rbac' || verb === 'deny'))
    return { level: 'warn', label: verb === 'deny' ? 'denied' : 'failed', tone: 'warning' };

  return { level: 'none', label: '', tone: '' };
}

// A concise label for a high-severity event when no known flag names it.
function shortLabel(e: AuditEvent): string {
  if (e.changes?.summary) {
    const s = e.changes.summary;
    return s.length > 40 ? s.slice(0, 38) + '…' : s;
  }
  const flag = (e.changes?.flags ?? []).find(f => f in RISK_FLAG_LABEL);
  if (flag) return RISK_FLAG_LABEL[flag];
  return '';
}

// Text-colour utility for a risk tone ('' when none).
export const riskTextClass = (tone: RiskInfo['tone']): string =>
  tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : '';

// Plain-language sentence for a high-risk row on the hero.
export function plainSentence(e: AuditEvent): string {
  if (e.changes?.summary) return e.changes.summary;
  const who = !e.who || e.who === 'system' ? 'The system' : (e.actorName || e.who.split('@')[0]);
  const verb = e.verb || 'changed';
  const what = e.target || e.path || e.category;
  return `${who} ${verb} ${what}`.trim();
}

// ─── Trend helper for the summary band ──────────────────────────────────────
export type Trend = { dir: 'up' | 'down' | 'flat'; pct: number } | null;
export function trend(cur?: number, prev?: number): Trend {
  if (cur == null || prev == null) return null;
  const delta = cur - prev;
  if (delta === 0) return { dir: 'flat', pct: 0 };
  const pct = prev === 0 ? 100 : Math.round((delta / prev) * 100);
  return { dir: delta > 0 ? 'up' : 'down', pct: Math.abs(pct) };
}

// Normalize a failure rate that may arrive as a fraction (0..1) or a percent.
export function failurePct(s?: AuditSummary, loaded?: AuditEvent[]): number {
  if (s) {
    if (typeof s.failureRate === 'number') return s.failureRate <= 1 ? s.failureRate * 100 : s.failureRate;
    const r = s.byResult || {};
    const failed = (r.denied || 0) + (r.failed || 0) + (r.error || 0);
    const total = s.total || Object.values(r).reduce((a, b) => a + b, 0);
    return total ? (failed / total) * 100 : 0;
  }
  if (loaded && loaded.length) {
    const failed = loaded.filter(e => e.status === 'failed' || e.verb === 'fail' || e.verb === 'deny').length;
    return (failed / loaded.length) * 100;
  }
  return 0;
}
export const rateTone = (pct: number): 'danger' | 'warning' | 'success' =>
  (pct >= 10 ? 'danger' : pct >= 2 ? 'warning' : 'success');
