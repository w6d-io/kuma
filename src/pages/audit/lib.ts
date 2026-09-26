import type { AuditEvent } from '../../api/types';

// ─── Risk classifier for legacy trail events ─────────────────────────────────
// Display-only: labels a row the Overview and Access review already hold. The audit page itself
// reads `severity` and `flags` from the audit/v1 event. Severity is expressed strictly through
// semantic tokens (danger / warning) — NEVER accent. RISK_FLAG_LABEL is shared with the audit page.
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
