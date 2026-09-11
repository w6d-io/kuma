import { useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useAccessReview, useAuditEvents } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, PermTree, EmptyHint } from '../components/ui/Primitives';
import { timeAgo } from '../api/transforms';
import { RiskBadge } from './Audit';
import type { AccessReviewIdentity } from '../api/types';
import { SkeletonPanel } from '../components/ui/Skeleton';

// Tier catalog — power class an identity resolves to (jinbe Part B resolver).
const TIER_META: Record<number, { label: string; short: string; tone: string; desc: string }> = {
  0: { label: 'Global super-admin', short: 'T0', tone: 'err',  desc: 'Can do anything, everywhere.' },
  1: { label: 'Service wildcard',   short: 'T1', tone: 'err',  desc: 'Full control (*) of one or more services.' },
  2: { label: 'Organization admin', short: 'T2', tone: 'warn', desc: 'Administers one or more organizations.' },
  3: { label: 'Broad reach',        short: 'T3', tone: 'info', desc: 'Elevated access across several services.' },
};
const tierMeta = (t: number) => TIER_META[t] || { label: `Tier ${t}`, short: `T${t}`, tone: '', desc: '' };

// Flag catalog — the risk markers a power holder can carry.
const FLAG_META: Record<string, { label: string; tone: string; desc: string }> = {
  'global-super-admin':        { label: 'super-admin',      tone: 'err',  desc: 'Holds the global super_admin role.' },
  'wildcard':                  { label: 'wildcard (*)',     tone: 'err',  desc: 'A service role grants the * permission.' },
  'sprawl':                    { label: 'sprawl',           tone: 'warn', desc: 'Broad reach across many services.' },
  'self-granted':              { label: 'self-granted',     tone: 'err',  desc: 'Granted itself this power (actor == target).' },
  'dormant':                   { label: 'dormant',          tone: 'warn', desc: 'No recent activity while retaining power.' },
  'no-mfa':                    { label: 'no MFA',           tone: 'err',  desc: 'Privileged without a second factor.' },
  'org-admin-broad-reach':     { label: 'org-admin reach',  tone: 'warn', desc: 'Org-admin spanning many services.' },
  'inactive-retaining-power':  { label: 'inactive',         tone: 'warn', desc: 'Deactivated identity still holds power.' },
  'orphaned-group':            { label: 'orphaned group',   tone: 'warn', desc: 'Member of a group with no definition.' },
  'unaccounted-power':         { label: 'unaccounted',      tone: 'warn', desc: 'Power with no traceable grant path.' },
  'granted-but-unused':        { label: 'granted, unused',  tone: 'info', desc: 'Holds power it has never exercised.' },
};
const flagMeta = (f: string) => FLAG_META[f] || { label: f, tone: '', desc: '' };

// last-active may arrive as ISO, a relative string, or null.
function fmtLast(v?: string | null): string {
  if (!v) return 'never';
  const d = new Date(v);
  return isNaN(+d) ? v : timeAgo(v);
}

export function AccessReviewPage() {
  const { state } = useApp();
  const { data, isLoading, isError, error } = useAccessReview();
  const [sel, setSel] = useState<AccessReviewIdentity | null>(null);

  const ranked = useMemo(() => {
    const ids = [...(data?.identities ?? [])];
    ids.sort((a, b) =>
      (b.powerScore ?? 0) - (a.powerScore ?? 0) ||
      (a.tier - b.tier) ||
      ((b.reach ?? 0) - (a.reach ?? 0)),
    );
    return ids;
  }, [data]);

  const header = (
    <div className="page-head">
      <div>
        <h1>Access review</h1>
        <div className="sub">Who can do anything — and how they got it</div>
      </div>
    </div>
  );

  if (isLoading) {
    return <>{header}<div aria-busy="true" aria-label="Resolving power across all services"><SkeletonPanel lines={6} /></div></>;
  }
  // Fail-closed: a load error must never read as "nobody has power".
  if (isError) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <>{header}
        <div className="panel" style={{ padding: 28 }}>
          <span className="small" style={{ color: 'var(--danger, #c0392b)' }}>
            Couldn&apos;t load the access review{status ? ` (HTTP ${status})` : ''} — this is a load error, not "no privileged users".
            Reload to retry; do not treat the absence of results as a clean posture.
          </span>
        </div>
      </>
    );
  }

  const s = data?.summary;

  return (
    <>
      {header}

      {/* ── Posture banner (plain language) ── */}
      <div className="panel mb-12" style={{ padding: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <PostureCell n={s?.canDoAnything ?? 0} label="can do anything" tone={(s?.canDoAnything ?? 0) > 0 ? 'err' : 'ok'} first />
          <PostureCell n={s?.selfGranted ?? 0} label="self-granted" tone={(s?.selfGranted ?? 0) > 0 ? 'err' : 'ok'} />
          <PostureCell n={s?.dormant ?? 0} label="dormant" tone={(s?.dormant ?? 0) > 0 ? 'warn' : 'ok'} />
          <PostureCell n={s?.noMfa ?? 0} label="without MFA" tone={(s?.noMfa ?? 0) > 0 ? 'err' : 'ok'} />
        </div>
        <div className="small muted" style={{ padding: '8px 16px', borderTop: '1px solid var(--line)' }}>
          {s
            ? <>{s.totalPrivileged} privileged {s.totalPrivileged === 1 ? 'identity' : 'identities'} · {s.canDoAnything} can do anything, {s.selfGranted} self-granted, {s.dormant} dormant.</>
            : 'No summary available.'}
        </div>
      </div>

      {/* ── Ranked power list ── */}
      <div className="panel">
        <div className="panel-head">
          <div><h3>Power holders</h3><div className="sub">Ranked by reach and privilege — click a person to see why</div></div>
          <Chip>{ranked.length}</Chip>
        </div>
        {ranked.length === 0 ? (
          <div style={{ padding: 18, display: 'flex', gap: 10, alignItems: 'center', color: 'var(--ink-3)' }}>
            <span style={{ color: 'var(--ok)' }}>{I.check}</span>
            <div className="small">No identity resolves to elevated power. This is a clean posture.</div>
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Identity</th><th>Tier</th><th>Reach</th><th>How</th><th>Flags</th><th>Last active</th><th></th></tr></thead>
            <tbody>
              {ranked.map(u => {
                const tm = tierMeta(u.tier);
                const how = u.paths?.[0]?.summary || (u.groups[0] ? `group · ${u.groups[0]}` : '—');
                return (
                  <tr key={u.id} className="row-click" onClick={() => setSel(u)}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar name={u.name} email={u.email} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>
                            {u.name || u.email.split('@')[0]}
                            {u.active === false && <> <Chip tone="warn">inactive</Chip></>}
                          </div>
                          <div className="small muted mono">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Chip tone={tm.tone} mono={false} title={tm.desc}>{tm.short} · {tm.label}</Chip></td>
                    <td><span className="small mono">{u.reach ?? u.services?.length ?? 0} svc</span></td>
                    <td><span className="small mono muted" title={how}>{how.length > 32 ? how.slice(0, 30) + '…' : how}</span></td>
                    <td>
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {u.flags.length === 0 ? <span className="small muted">—</span> : u.flags.slice(0, 3).map(f => {
                          const fm = flagMeta(f);
                          return <Chip key={f} tone={fm.tone} mono={false} title={fm.desc}>{fm.label}</Chip>;
                        })}
                        {u.flags.length > 3 && <Chip title={u.flags.slice(3).join(', ')}>+{u.flags.length - 3}</Chip>}
                      </span>
                    </td>
                    <td className="small muted nowrap">{fmtLast(u.lastActive)}</td>
                    <td style={{ width: 24, textAlign: 'right' }}><span style={{ color: 'var(--ink-4)' }}>{I.chev}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="small muted" style={{ marginTop: 10, textAlign: 'center', opacity: 0.75 }}>
        {data?.limits?.note || 'Provenance and "last active" are bounded by the audit stream cap (Redis-only store).'}
      </div>

      <AccessReviewDrawer identity={sel} onClose={() => setSel(null)} state={state} />
    </>
  );
}

function PostureCell({ n, label, tone, first }: { n: number; label: string; tone: string; first?: boolean }) {
  return (
    <div style={{ padding: '16px 18px', borderLeft: first ? 'none' : '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.4, color: n > 0 ? `var(--${tone})` : 'var(--ink)' }}>{n}</span>
      <span className="small muted">{label}</span>
    </div>
  );
}

function AccessReviewDrawer({ identity, onClose, state }: {
  identity: AccessReviewIdentity | null;
  onClose: () => void;
  state: ReturnType<typeof useApp>['state'];
}) {
  // "Are they using it" — recent actions by this actor (fail-closed: empty ≠ error).
  const trailQ = useAuditEvents({ actor: identity?.email || '', limit: 8 }, !!identity);
  if (!identity) return null;
  const tm = tierMeta(identity.tier);
  const trail = trailQ.data ?? [];

  return (
    <Drawer
      open={!!identity}
      onClose={onClose}
      size="lg"
      eyebrow="Access review"
      title={identity.name || identity.email}
    >
      <div className="panel mb-12" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Avatar name={identity.name} email={identity.email} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{identity.name || identity.email.split('@')[0]}</div>
          <div className="small muted mono">{identity.email}</div>
        </div>
        <Chip tone={tm.tone} mono={false} title={tm.desc}>{tm.short} · {tm.label}</Chip>
      </div>

      {/* Flags */}
      {identity.flags.length > 0 && (
        <div className="mb-12">
          <label className="input-label">Signals</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {identity.flags.map(f => {
              const fm = flagMeta(f);
              return <Chip key={f} tone={fm.tone} mono={false} title={fm.desc}>{fm.label}</Chip>;
            })}
          </div>
        </div>
      )}

      {/* Why they can do this */}
      <div className="mb-12">
        <label className="input-label">Why they can do this</label>
        <div className="panel" style={{ padding: 12 }}>
          <PermTree user={{ name: identity.name || identity.email, email: identity.email, groups: identity.groups }} state={state} />
        </div>
      </div>

      {/* Provenance — how they got it */}
      <div className="mb-12">
        <label className="input-label">How they got it</label>
        <div className="panel" style={{ padding: 12 }}>
          {(identity.paths?.length ?? 0) > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {identity.paths!.map((p, i) => (
                <div key={i} className="small mono">
                  <span className="muted">group</span> {p.group}
                  {p.service && <> <span className="muted">→</span> {p.service}</>}
                  {p.role && <>:{p.role}</>}
                </div>
              ))}
            </div>
          ) : <span className="small muted">No traceable grant path — investigate as unaccounted power.</span>}
          <div className="small muted mt-4" style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
            {identity.grantedBy
              ? <>Granted by <span className="mono">{identity.grantedBy}</span>{identity.grantedAt ? <> · {fmtLast(identity.grantedAt)}</> : null}{identity.selfGranted && <> · <span style={{ color: 'var(--err)' }}>self-granted</span></>}</>
              : 'Grant provenance not recorded (predates audit capture or beyond retention).'}
          </div>
        </div>
      </div>

      {/* Are they using it */}
      <div>
        <label className="input-label">Are they using it</label>
        <div className="panel" style={{ padding: 12 }}>
          <div className="small muted mb-12">
            Last active <b style={{ color: 'var(--ink)' }}>{fmtLast(identity.lastActive)}</b>
            {identity.lastPrivilegedAction && <> · last privileged action {fmtLast(identity.lastPrivilegedAction)}</>}
            {identity.mfa === false && <> · <span style={{ color: 'var(--err)' }}>no second factor</span></>}
          </div>
          {trailQ.isError ? (
            <span className="small" style={{ color: 'var(--danger, #c0392b)' }}>Couldn&apos;t load recent activity (load error, not "no activity").</span>
          ) : trail.length === 0 ? (
            <EmptyHint>{trailQ.isLoading ? 'Loading…' : 'No recorded actions in the retained window.'}</EmptyHint>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {trail.map(e => (
                <div key={e.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="small muted mono nowrap" style={{ width: 64 }}>{e.when}</span>
                  <span className="small mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <b style={{ fontWeight: 600 }}>{e.verb}</b> {e.changes?.summary || e.target}
                  </span>
                  <RiskBadge e={e} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
