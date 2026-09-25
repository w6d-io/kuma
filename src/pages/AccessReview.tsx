import { useMemo, useState } from 'react';
import { useAccessReview, useAuditEvents, usePermissionChain } from '../api/hooks';
import { ApiErrorState } from '../components/ApiErrorState';
import { PermTree } from '../components/ui/Primitives';
import { Avatar, Badge, Card, Drawer, EmptyHint, I, PageHeader, Table, type BadgeTone } from '../components/ui';
import { timeAgo } from '../api/transforms';
import { RiskBadge } from './Audit';
import type { AccessReviewIdentity } from '../api/types';
import { SkeletonPanel } from '../components/ui/Skeleton';

// Tier catalog — power class an identity resolves to (jinbe Part B resolver).
const TIER_META: Record<number, { label: string; short: string; tone: BadgeTone; desc: string }> = {
  0: { label: 'Global super-admin', short: 'T0', tone: 'danger',  desc: 'Can do anything, everywhere.' },
  1: { label: 'Service wildcard',   short: 'T1', tone: 'danger',  desc: 'Full control (*) of one or more services.' },
  2: { label: 'Organization admin', short: 'T2', tone: 'warning', desc: 'Administers one or more organizations.' },
  3: { label: 'Broad reach',        short: 'T3', tone: 'info', desc: 'Elevated access across several services.' },
};
const tierMeta = (t: number) => TIER_META[t] || { label: `Tier ${t}`, short: `T${t}`, tone: 'neutral' as BadgeTone, desc: '' };

// Flag catalog — the risk markers a power holder can carry.
const FLAG_META: Record<string, { label: string; tone: BadgeTone; desc: string }> = {
  'global-super-admin':        { label: 'super-admin',      tone: 'danger',  desc: 'Holds the global super_admin role.' },
  'wildcard':                  { label: 'wildcard (*)',     tone: 'danger',  desc: 'A service role grants the * permission.' },
  'sprawl':                    { label: 'sprawl',           tone: 'warning', desc: 'Broad reach across many services.' },
  'self-granted':              { label: 'self-granted',     tone: 'danger',  desc: 'Granted itself this power (actor == target).' },
  'dormant':                   { label: 'dormant',          tone: 'warning', desc: 'No recent activity while retaining power.' },
  'no-mfa':                    { label: 'no MFA',           tone: 'danger',  desc: 'Privileged without a second factor.' },
  'org-admin-broad-reach':     { label: 'org-admin reach',  tone: 'warning', desc: 'Org-admin spanning many services.' },
  'inactive-retaining-power':  { label: 'inactive',         tone: 'warning', desc: 'Deactivated identity still holds power.' },
  'orphaned-group':            { label: 'orphaned group',   tone: 'warning', desc: 'Member of a group with no definition.' },
  'unaccounted-power':         { label: 'unaccounted',      tone: 'warning', desc: 'Power with no traceable grant path.' },
  'granted-but-unused':        { label: 'granted, unused',  tone: 'info', desc: 'Holds power it has never exercised.' },
};
const flagMeta = (f: string) => FLAG_META[f] || { label: f, tone: 'neutral' as BadgeTone, desc: '' };

// last-active may arrive as ISO, a relative string, or null.
function fmtLast(v?: string | null): string {
  if (!v) return 'never';
  const d = new Date(v);
  return isNaN(+d) ? v : timeAgo(v);
}

export function AccessReviewPage() {
  const { data, isLoading, isError, error, refetch } = useAccessReview();
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

  const header = <PageHeader title="Access review" sub="Who can do anything — and how they got it" />;

  if (isLoading) {
    return <>{header}<div aria-busy="true" aria-label="Resolving power across all services"><SkeletonPanel lines={6} /></div></>;
  }
  // Fail-closed: a load error must never read as "nobody has power".
  if (isError) {
    return (
      <>{header}
        <ApiErrorState what="the access review" error={error} onRetry={() => refetch()} />
        <div className="small muted mt-8">
          This is a load error, not &ldquo;no privileged users&rdquo; — do not read the absence of results as a clean posture.
        </div>
      </>
    );
  }

  const s = data?.summary;

  return (
    <>
      {header}

      {/* ── Posture banner (plain language) ── */}
      <Card className="mb-12">
        <div className="posture">
          <PostureCell n={s?.canDoAnything ?? 0} label="can do anything" tone="danger" />
          <PostureCell n={s?.selfGranted ?? 0} label="self-granted" tone="danger" />
          <PostureCell n={s?.dormant ?? 0} label="dormant" tone="warning" />
          <PostureCell n={s?.noMfa ?? 0} label="without MFA" tone="danger" />
        </div>
        <div className="small muted py-8 px-16 border-t">
          {s
            ? <>{s.totalPrivileged} privileged {s.totalPrivileged === 1 ? 'identity' : 'identities'} · {s.canDoAnything} can do anything, {s.selfGranted} self-granted, {s.dormant} dormant.</>
            : 'No summary available.'}
        </div>
      </Card>

      {/* ── Ranked power list ── */}
      <Card
        title="Power holders"
        sub="Ranked by reach and privilege — click a person to see why"
        actions={<Badge>{ranked.length}</Badge>}
        pad="none"
      >
        {ranked.length === 0 ? (
          <div className="row gap-12 p-16 muted">
            <span className="text-success">{I.check}</span>
            <div className="small">No identity resolves to elevated power. This is a clean posture.</div>
          </div>
        ) : (
          <Table>
            <thead><tr><th>Identity</th><th>Tier</th><th>Reach</th><th>How</th><th>Flags</th><th>Last active</th><th></th></tr></thead>
            <tbody>
              {ranked.map(u => {
                const tm = tierMeta(u.tier);
                const how = u.paths?.[0]?.summary || (u.groups[0] ? `group · ${u.groups[0]}` : '—');
                return (
                  <tr key={u.id} className="row-click" onClick={() => setSel(u)}>
                    <td>
                      <div className="row gap-12">
                        <Avatar name={u.name} email={u.email} />
                        <div className="min-w-0">
                          <div className="fw-medium">
                            {u.name || u.email.split('@')[0]}
                            {u.active === false && <> <Badge tone="warning">inactive</Badge></>}
                          </div>
                          <div className="small muted mono">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Badge tone={tm.tone} mono={false} title={tm.desc}>{tm.short} · {tm.label}</Badge></td>
                    <td><span className="small mono">{u.reach ?? u.services?.length ?? 0} svc</span></td>
                    <td><span className="small mono muted" title={how}>{how.length > 32 ? how.slice(0, 30) + '…' : how}</span></td>
                    <td>
                      <span className="row wrap gap-4">
                        {u.flags.length === 0 ? <span className="small muted">—</span> : u.flags.slice(0, 3).map(f => {
                          const fm = flagMeta(f);
                          return <Badge key={f} tone={fm.tone} mono={false} title={fm.desc}>{fm.label}</Badge>;
                        })}
                        {u.flags.length > 3 && <Badge title={u.flags.slice(3).join(', ')}>+{u.flags.length - 3}</Badge>}
                      </span>
                    </td>
                    <td className="small muted nowrap">{fmtLast(u.lastActive)}</td>
                    <td className="ar-chev text-right"><span className="text-disabled">{I.chev}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="small text-disabled mt-12 text-center">
        {data?.limits?.note || 'Provenance and "last active" are bounded by the audit stream cap (Redis-only store).'}
      </div>

      <AccessReviewDrawer identity={sel} onClose={() => setSel(null)} />
    </>
  );
}

function PostureCell({ n, label, tone }: { n: number; label: string; tone: 'danger' | 'warning' }) {
  return (
    <div className="posture-cell">
      <span className={n > 0 ? `posture-n text-${tone}` : 'posture-n'}>{n}</span>
      <span className="small muted">{label}</span>
    </div>
  );
}

function AccessReviewDrawer({ identity, onClose }: {
  identity: AccessReviewIdentity | null;
  onClose: () => void;
}) {
  // "Are they using it" — recent actions by this actor (fail-closed: empty ≠ error).
  const trailQ = useAuditEvents({ actor: identity?.email || '', limit: 8 }, !!identity);
  const chain = usePermissionChain();
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
      <Card pad="md" className="mb-12">
        <div className="row gap-12">
          <Avatar name={identity.name} email={identity.email} size={36} />
          <div className="flex-1 min-w-0">
            <div className="fw-medium">{identity.name || identity.email.split('@')[0]}</div>
            <div className="small muted mono">{identity.email}</div>
          </div>
          <Badge tone={tm.tone} mono={false} title={tm.desc}>{tm.short} · {tm.label}</Badge>
        </div>
      </Card>

      {/* Flags */}
      {identity.flags.length > 0 && (
        <div className="mb-12">
          <label className="input-label">Signals</label>
          <div className="row wrap gap-8">
            {identity.flags.map(f => {
              const fm = flagMeta(f);
              return <Badge key={f} tone={fm.tone} mono={false} title={fm.desc}>{fm.label}</Badge>;
            })}
          </div>
        </div>
      )}

      {/* Why they can do this */}
      <div className="mb-12">
        <label className="input-label">Why they can do this</label>
        <Card pad="sm">
          <PermTree user={{ name: identity.name || identity.email, email: identity.email, groups: identity.groups }} model={chain.model} routeTables={chain.routeTables} />
        </Card>
      </div>

      {/* Provenance — how they got it */}
      <div className="mb-12">
        <label className="input-label">How they got it</label>
        <Card pad="sm">
          {(identity.paths?.length ?? 0) > 0 ? (
            <div className="col gap-4">
              {identity.paths!.map((p, i) => (
                <div key={i} className="small mono">
                  <span className="muted">group</span> {p.group}
                  {p.service && <> <span className="muted">→</span> {p.service}</>}
                  {p.role && <>:{p.role}</>}
                </div>
              ))}
            </div>
          ) : <span className="small muted">No traceable grant path — investigate as unaccounted power.</span>}
          <div className="small muted ar-provenance">
            {identity.grantedBy
              ? <>Granted by <span className="mono">{identity.grantedBy}</span>{identity.grantedAt ? <> · {fmtLast(identity.grantedAt)}</> : null}{identity.selfGranted && <> · <span className="text-danger">self-granted</span></>}</>
              : 'Grant provenance not recorded (predates audit capture or beyond retention).'}
          </div>
        </Card>
      </div>

      {/* Are they using it */}
      <div>
        <label className="input-label">Are they using it</label>
        <Card pad="sm">
          <div className="small muted mb-12">
            Last active <b className="text-default">{fmtLast(identity.lastActive)}</b>
            {identity.lastPrivilegedAction && <> · last privileged action {fmtLast(identity.lastPrivilegedAction)}</>}
            {identity.mfa === false && <> · <span className="text-danger">no second factor</span></>}
          </div>
          {trailQ.isError ? (
            <span className="small text-danger">Couldn&apos;t load recent activity (load error, not "no activity").</span>
          ) : trail.length === 0 ? (
            <EmptyHint>{trailQ.isLoading ? 'Loading…' : 'No recorded actions in the retained window.'}</EmptyHint>
          ) : (
            <div className="col gap-4">
              {trail.map(e => (
                <div key={e.id} className="row gap-8">
                  <span className="small muted mono nowrap ar-when">{e.when}</span>
                  <span className="small mono flex-1 min-w-0 ar-trail">
                    <b className="fw-semibold">{e.verb}</b> {e.changes?.summary || e.target}
                  </span>
                  <RiskBadge e={e} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Drawer>
  );
}
