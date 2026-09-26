import { Button, ButtonBase, Card, I } from '../../../components/ui';
import { useVersions } from '../../../api/sites';
import { kindOf } from '../../../lib/sites/templates';
import type { SiteEditor } from '../useSiteEditor';
import type { Go } from '../SiteDetail';
import { accessWord, timeAgo } from '../../../lib/sites/format';

/** Overview (site-ux.md §5.2): how requests flow, who has access, what happened last. */
export function OverviewTab({ ed, go }: { ed: SiteEditor; go: Go }) {
  const s = ed.current!;
  const versions = useVersions(ed.name);
  const gates = s.gates ?? [];
  const items = s.routes?.items ?? [];
  const catchAll = s.routes?.catchAll;
  const groups = Object.entries(s.groups?.platform ?? {});
  const orgGrantable = Object.keys(s.groups?.orgGrantable ?? {});
  const recent = (versions.data ?? []).slice(-3).reverse();

  return (
    <div className="site-grid">
      <Card title="How requests flow" sub={`${kindOf({ gates })} · ${items.length} route${items.length === 1 ? '' : 's'} + everything else`}>
        <div className="site-flow" aria-label="Request flow">
          <div className="site-flow-node">visitor</div>
          <span className="site-flow-arrow" aria-hidden="true">{I.caretRight}</span>
          <div className="site-flow-node mono">{s.address?.host}{s.address?.pathPrefix ?? ''}</div>
          <span className="site-flow-arrow" aria-hidden="true">{I.caretRight}</span>
          <ul className="site-flow-gates">
            {gates.map((g) => {
              const n = items.filter((r) => r.gate === g.id && r.access.kind !== 'deny').length;
              const isCatchAll = catchAll?.gate === g.id;
              return (
                <li key={g.id}>
                  <ButtonBase className="site-flow-gate" onClick={() => go('gates', { gate: g.id })}>
                    <span className="fw-medium">{g.label}</span>
                    <span className="small muted">{n} route{n === 1 ? '' : 's'}{isCatchAll ? ' · everything else' : ''}</span>
                  </ButtonBase>
                </li>
              );
            })}
          </ul>
          <span className="site-flow-arrow" aria-hidden="true">{I.caretRight}</span>
          <div className="site-flow-node mono">{s.upstream?.service}.{s.upstream?.namespace}:{s.upstream?.port}</div>
        </div>
        {catchAll && <p className="small muted mb-0 mt-12">Requests that match no route go to <b>{gates.find((g) => g.id === catchAll.gate)?.label ?? catchAll.gate}</b> and need <b>{accessWord(catchAll.access)}</b>.</p>}
      </Card>

      <Card title="Who has access" actions={<Button size="sm" variant="ghost" onClick={() => go('access')}>Open</Button>}>
        {groups.length === 0 && orgGrantable.length === 0
          ? <p className="m-0 small">Nobody but super admins can use {s.displayName} yet. Map a group or make it available to an organization.</p>
          : (
            <dl className="site-kv">
              <dt>Groups</dt><dd>{groups.map(([g, roles]) => `${g} → ${roles.join(', ')}`).join(' · ') || '—'}</dd>
              <dt>Organizations</dt><dd>{(s.orgs?.length ?? 0) === 0 ? 'none' : `${s.orgs!.length}`}{orgGrantable.length ? ` · org admins can give ${orgGrantable.join(', ')}` : ''}</dd>
              <dt>Two-factor</dt><dd>{s.login?.twoFactor.scope === 'writes' ? 'required for changes' : s.login?.twoFactor.scope === 'all' ? 'required for everything' : 'not required'}</dd>
            </dl>
          )}
      </Card>

      <Card title="Recent activity" actions={<Button size="sm" variant="ghost" onClick={() => go('history')}>History</Button>}>
        {recent.length === 0
          ? <p className="m-0 small">{ed.neverSaved ? 'Not applied yet. Review the draft and go live.' : 'No versions yet.'}</p>
          : (
            <ul className="site-activity">
              {recent.map((v) => (
                <li key={v.v}><span className="mono">v{v.v}</span> {v.kind === 'rollback' ? 'rolled back' : 'saved'} by {v.by} · {timeAgo(v.at)}{v.note ? ` · “${v.note}”` : ''}</li>
              ))}
            </ul>
          )}
        {ed.detail.data?.applied && <p className="small muted mb-0 mt-8">v{ed.detail.data.applied.version} live since {timeAgo(ed.detail.data.applied.at)} · {ed.detail.data.applied.rules.length} gateway rule{ed.detail.data.applied.rules.length === 1 ? '' : 's'}</p>}
      </Card>
    </div>
  );
}
