import { useMemo } from 'react';
import { useApp } from '../../contexts/AppContext';
import { Avatar, Badge, EmptyHint } from '../../components/ui';
import { siteChain } from '../../lib/rbacEdit';

/**
 * Why a person has what they have, from the site groups and roles jinbe serves the engine: group →
 * site → role → permission → the routes it opens.
 */
export function SiteAccessTree({ user }: { user: { name: string; email: string; groups: string[] } }) {
  const { state } = useApp();
  const branches = useMemo(
    () => siteChain(user.groups, state.groups, state.roles, state.routeMaps),
    [user.groups, state.groups, state.roles, state.routeMaps],
  );

  return (
    <div className="permtree">
      <div className="pt-root">
        <Avatar name={user.name} size={26} />
        <div>
          <div className="fw-medium">{user.name}</div>
          <div className="small muted mono">{user.email}</div>
        </div>
      </div>
      {branches.length === 0 && <EmptyHint>No groups &rarr; no access.</EmptyHint>}
      {branches.map((b) => (
        <div key={b.group} className="pt-branch">
          <div className="pt-line v" />
          <div className="pt-group">
            <span className="pt-line h" />
            <span className="mono pt-chip">group &middot; {b.group}</span>
            {!b.declared && <Badge tone="danger" title="Held, but no such group exists">unknown group</Badge>}
          </div>
          {b.declared && b.sites.length === 0 && (
            <div className="pt-svc"><span className="small muted">&mdash; gives nothing &mdash;</span></div>
          )}
          {b.sites.map((s) => (
            <div key={s.site} className="pt-svc">
              <span className="pt-line h" />
              <span className="mono pt-chip">on {s.site}</span>
              {s.roles.map((r) => (
                <div key={r.role} className="pt-role">
                  <span className="mono">{r.role}</span>
                  <div className="pt-perms">
                    {!r.known && <Badge tone="danger" title={`Not defined on ${s.site}`}>undefined role</Badge>}
                    {r.everything && <Badge tone="accent" mono={false}>Everything in this site</Badge>}
                    {r.known && !r.everything && r.permissions.length === 0 && <span className="small muted">&mdash; carries nothing &mdash;</span>}
                    {r.permissions.map((p) => (
                      <span key={p.permission} className="pt-perm">
                        <Badge>{p.permission}</Badge>
                        {p.routes.length === 0
                          ? <span className="small muted">no route asks for it</span>
                          : <span className="small muted" title={p.routes.map((x) => `${x.method} ${x.path}`).join('\n')}>
                              {p.routes.length} route{p.routes.length === 1 ? '' : 's'} &middot;{' '}
                              <span className="mono">{p.routes.slice(0, 2).map((x) => `${x.method} ${x.path}`).join(', ')}</span>
                              {p.routes.length > 2 && ` +${p.routes.length - 2}`}
                            </span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
