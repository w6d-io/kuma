import { useState } from 'react';
import { Button, Callout, Card, Checkbox, EmptyHint, Field, I, Input, Segmented, Select, Table, Th } from '../../../components/ui';
import { useAllOrganizations, useGroupsMap } from '../../../api/hooks';
import { accessMatrix, expandRolePermissions, PUBLIC, SIGNED_IN } from '../../../lib/sites/access';
import { orgGrantableFor } from '../../../lib/sites/templates';
import type { RolesPreset, Site } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';
import type { Go } from '../SiteDetail';
import { CheckList, type CheckLine } from '../parts';

/**
 * Access (site-ux.md §8): who can do what on this site — the matrix, the roles, the groups that
 * carry them, and the organizations that may use it. Changes land in the draft like everything else.
 */

type View = 'matrix' | 'roles' | 'groups' | 'orgs';

export function AccessTab({ ed, readOnly, query, go }: { ed: SiteEditor; readOnly: boolean; query: Record<string, string>; go: Go }) {
  const site = ed.site;
  if (!site) return <Callout tone="warning" icon={I.alert}>This draft is incomplete.</Callout>;
  const view: View = (['matrix', 'roles', 'groups', 'orgs'] as const).find((v) => v === query.view) ?? 'matrix';
  const set = (fn: (s: Site) => Site) => ed.update(fn);
  return (
    <div className="stack gap-16">
      <div className="row gap-8 wrap items-center justify-between">
        <Segmented label="Access view" value={view} onChange={(v) => go('access', { view: v === 'matrix' ? undefined : v })} options={[
          { value: 'matrix', label: 'Matrix' }, { value: 'roles', label: 'Roles' }, { value: 'groups', label: 'Groups' }, { value: 'orgs', label: 'Organizations' },
        ]} />
        <a className="small" href={`#/access-check?app=${encodeURIComponent(site.name)}`}>Open Access checker {I.arrowOut}</a>
      </div>
      {view === 'matrix' && <MatrixView site={site} />}
      {view === 'roles' && <RolesView site={site} readOnly={readOnly} set={set} />}
      {view === 'groups' && <GroupsView site={site} readOnly={readOnly} set={set} />}
      {view === 'orgs' && <OrgsView site={site} readOnly={readOnly} set={set} />}
    </div>
  );
}

function MatrixView({ site }: { site: Site }) {
  const m = accessMatrix(site);
  const notes: CheckLine[] = [
    ...m.unreachable.map((p) => ({ level: 'warn' as const, text: `Nobody can reach routes needing ${p} — no role carries it. Add it to a role (Roles).` })),
    ...m.unused.slice(0, 5).map((p) => ({ level: 'info' as const, text: `${p} is carried by a role but no route needs it (unused).` })),
  ];
  if (site.login?.twoFactor.scope && site.login.twoFactor.scope !== 'none') {
    notes.push({ level: 'info', text: `2FA required ${site.login.twoFactor.scope === 'writes' ? 'for changes' : 'for everything'} (Login tab).` });
  }
  return (
    <Card pad="none" title={`Who can do what on ${site.displayName}`} sub="Org grants apply only on org-scoped routes and never remove site access. People counts arrive with the server matrix.">
      <Table className="site-matrix" aria-label="Access matrix">
        <thead>
          <tr><Th scope="col">Who</Th>{m.columns.map((c) => <Th key={c} scope="col" className="mono small">{c}</Th>)}</tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={`${r.kind}-${r.id}`}>
              <th scope="row" className="small">{r.label}</th>
              {m.columns.map((c) => (
                <td key={c} className="align-center">
                  <span role="img" aria-label={`${r.label}, ${c}: ${r.cells[c] ? 'allowed' : 'not allowed'}`} className={r.cells[c] ? 'text-success' : 'muted'}>{r.cells[c] ? '✓' : '·'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="p-12"><CheckList lines={notes} /></div>
      <p className="small muted m-0 p-12">{SIGNED_IN}: any account passes; {PUBLIC}: no sign-in.</p>
    </Card>
  );
}

function RolesView({ site, readOnly, set }: { site: Site; readOnly: boolean; set: (fn: (s: Site) => Site) => void }) {
  const roles = expandRolePermissions(site);
  const preset = typeof site.roles === 'string' ? site.roles : 'custom';
  const needed = [...new Set([...site.routes.items, { access: site.routes.catchAll.access }].flatMap((r) => (r.access.kind === 'permission' ? [r.access.permission] : [])))];
  const perms = [...new Set([...needed, ...Object.values(roles).flat().filter((p) => p !== '*')])].sort();
  const [newRole, setNewRole] = useState('');
  const [newPerm, setNewPerm] = useState('');
  const mapped = new Set([...Object.values(site.groups.platform).flat(), ...Object.values(site.groups.orgGrantable).flatMap((g) => g.roles)]);
  const setRoles = (r: Record<string, string[]>) => set((s) => ({ ...s, roles: r }));
  const toggle = (role: string, perm: string, on: boolean) => setRoles({ ...roles, [role]: on ? [...(roles[role] ?? []), perm] : (roles[role] ?? []).filter((p) => p !== perm) });

  return (
    <Card title="Roles" sub="Named sets of permissions on this site.">
      <Field label="Template">
        <Select value={preset} disabled={readOnly} onChange={(e) => {
          const v = e.target.value;
          set((s) => ({ ...s, roles: v === 'custom' ? expandRolePermissions(s) : (v as RolesPreset) }));
        }}>
          <option value="standard">Standard: admin · editor · viewer</option>
          <option value="readonly">Read-only: viewer</option>
          <option value="operator">Operator: admin · operator · editor · viewer</option>
          <option value="custom">Custom</option>
        </Select>
      </Field>
      <Table className="site-matrix mt-12" aria-label="Roles and permissions">
        <thead><tr><Th scope="col">Role</Th>{perms.map((p) => <Th key={p} scope="col" className="mono small">{p}</Th>)}<Th scope="col">Everything</Th></tr></thead>
        <tbody>
          {Object.entries(roles).map(([role, held]) => (
            <tr key={role}>
              <th scope="row" className="mono small">{role}{!mapped.has(role) && <span className="muted"> (unmapped)</span>}</th>
              {perms.map((p) => (
                <td key={p} className="align-center">
                  <Checkbox label={<span className="sr-only">{role} {p}</span>} checked={held.includes('*') || held.includes(p)} disabled={readOnly || preset !== 'custom' || held.includes('*')} onChange={(on) => toggle(role, p, on)} />
                </td>
              ))}
              <td className="align-center"><Checkbox label={<span className="sr-only">{role} everything</span>} checked={held.includes('*')} disabled={readOnly || preset !== 'custom'} onChange={(on) => toggle(role, '*', on)} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="small muted">“Everything” covers every permission on this site, not org-scoped routes of other organizations.</p>
      {preset === 'custom' && !readOnly && (
        <div className="row gap-8 wrap">
          <Input size="sm" mono placeholder="new-role" aria-label="New role" value={newRole} onChange={(e) => setNewRole(e.target.value.toLowerCase())} />
          <Button size="sm" icon={I.plus} disabled={!/^[a-z][a-z0-9_-]{0,39}$/.test(newRole) || !!roles[newRole]} onClick={() => { setRoles({ ...roles, [newRole]: [] }); setNewRole(''); }}>Add role</Button>
          <Input size="sm" mono placeholder="reports:export" aria-label="New permission" value={newPerm} onChange={(e) => setNewPerm(e.target.value.trim())} />
          <Button size="sm" icon={I.plus} disabled={!/^[a-z][a-z0-9_.-]*:[a-z*][a-z0-9_*-]*$/.test(newPerm) || !roles.admin} title="Added to admin; tick it for other roles" onClick={() => { const first = Object.keys(roles).find((r) => !roles[r].includes('*')) ?? Object.keys(roles)[0]; toggle(first, newPerm, true); setNewPerm(''); }}>Add permission</Button>
        </div>
      )}
    </Card>
  );
}

function GroupsView({ site, readOnly, set }: { site: Site; readOnly: boolean; set: (fn: (s: Site) => Site) => void }) {
  const groups = useGroupsMap();
  const roles = Object.keys(expandRolePermissions(site));
  const existing = Object.keys(groups.data ?? {}).filter((g) => !site.groups.orgGrantable[g]).sort();
  const [pick, setPick] = useState('');
  const setPlatform = (p: Record<string, string[]>) => set((s) => ({ ...s, groups: { ...s.groups, platform: p } }));
  const setGrantable = (g: Site['groups']['orgGrantable']) => set((s) => ({ ...s, groups: { ...s.groups, orgGrantable: g } }));
  const others = (g: string) => Object.keys(groups.data?.[g] ?? {}).filter((svc) => svc !== site.name).length;

  return (
    <div className="stack gap-16">
      <Card title="Platform groups" sub="Shared groups (people everywhere). Only this site’s part of a group changes here.">
        {Object.keys(site.groups.platform).length === 0 && <EmptyHint>No group mapped: nobody but super admins can use {site.displayName}.</EmptyHint>}
        <ul className="site-list">
          {Object.entries(site.groups.platform).map(([g, rs]) => (
            <li key={g} className="row gap-8 items-center wrap">
              <span className="mono fw-medium">{g}</span>
              <span className="muted">→</span>
              <Select size="sm" aria-label={`${g} role`} value={rs[0] ?? ''} disabled={readOnly} onChange={(e) => setPlatform({ ...site.groups.platform, [g]: [e.target.value] })}>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
              {!groups.isLoading && !groups.data?.[g] && <span className="small text-danger">{g} doesn’t exist — create it on Groups first.</span>}
              {others(g) > 0 && <span className="small muted">also covers {others(g)} other site{others(g) === 1 ? '' : 's'}</span>}
              {!readOnly && <Button size="sm" variant="ghost" iconOnly icon={I.close} aria-label={`Unmap ${g}`} onClick={() => { const n = { ...site.groups.platform }; delete n[g]; setPlatform(n); }} />}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <div className="row gap-8 mt-8">
            <Select size="sm" aria-label="Add a group" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">+ add a group…</option>
              {existing.filter((g) => !site.groups.platform[g]).map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
            <Button size="sm" disabled={!pick} onClick={() => { setPlatform({ ...site.groups.platform, [pick]: [roles.includes('viewer') ? 'viewer' : roles[0]] }); setPick(''); }}>Map</Button>
          </div>
        )}
      </Card>

      <Card title="Org-grantable groups" sub="Owned by this site; org admins can hand them to their members.">
        {Object.keys(site.groups.orgGrantable).length === 0 && <EmptyHint>None. Org admins cannot give access to {site.displayName}.</EmptyHint>}
        <ul className="site-list">
          {Object.entries(site.groups.orgGrantable).map(([g, def]) => {
            const held = def.roles.flatMap((r) => expandRolePermissions(site)[r] ?? []);
            const lines: CheckLine[] = [
              { level: g.startsWith(`${site.name}-`) ? 'ok' : 'error', text: `named ${site.name}-…` },
              { level: held.length > 0 ? 'ok' : 'error', text: 'has permissions' },
              { level: held.includes('*') ? 'error' : 'ok', text: held.includes('*') ? 'carries “everything” — org admins may not hand that out' : 'no “everything” role' },
            ];
            return (
              <li key={g} className="stack gap-4">
                <div className="row gap-8 items-center wrap">
                  <span className="mono fw-medium">{g}</span>
                  <Input size="sm" aria-label={`${g} label`} value={def.label} disabled={readOnly} onChange={(e) => setGrantable({ ...site.groups.orgGrantable, [g]: { ...def, label: e.target.value } })} />
                  <Select size="sm" aria-label={`${g} role`} value={def.roles[0]} disabled={readOnly} onChange={(e) => setGrantable({ ...site.groups.orgGrantable, [g]: { ...def, roles: [e.target.value] } })}>
                    {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                  {!readOnly && <Button size="sm" variant="ghost" iconOnly icon={I.close} aria-label={`Remove ${g}`} onClick={() => { const n = { ...site.groups.orgGrantable }; delete n[g]; setGrantable(n); }} />}
                </div>
                <CheckList lines={lines} live={false} className="site-checks-inline" />
              </li>
            );
          })}
        </ul>
        {!readOnly && Object.keys(site.groups.orgGrantable).length === 0 && (
          <Button size="sm" icon={I.plus} className="mt-8" onClick={() => setGrantable(orgGrantableFor(site.name, site.displayName))}>Create {site.name}-editors and {site.name}-viewers</Button>
        )}
      </Card>
    </div>
  );
}

function OrgsView({ site, readOnly, set }: { site: Site; readOnly: boolean; set: (fn: (s: Site) => Site) => void }) {
  const orgs = useAllOrganizations();
  const list = orgs.data?.organizations ?? [];
  const name = (id: string) => list.find((o) => o.id === id)?.name ?? id;
  const [pick, setPick] = useState('');
  const setOrgs = (o: string[]) => set((s) => ({ ...s, orgs: o }));
  return (
    <Card title="Organizations" sub="Which organizations may use this site. Removing one stops its org grants on org-scoped routes; access through platform groups is unchanged.">
      {site.orgs.length === 0 && <EmptyHint>No organization. Only platform groups give access.</EmptyHint>}
      <ul className="site-list">
        {site.orgs.map((id) => (
          <li key={id} className="row gap-8 items-center">
            <span className="fw-medium">{name(id)}</span>
            <a className="small" href={`#/orgadmin?org=${encodeURIComponent(id)}&site=${encodeURIComponent(site.name)}`}>See its grants</a>
            {!readOnly && <Button size="sm" variant="ghost" iconOnly icon={I.close} aria-label={`Remove ${name(id)}`} onClick={() => setOrgs(site.orgs.filter((x) => x !== id))} />}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="row gap-8 mt-8">
          <Select size="sm" aria-label="Add an organization" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">+ pick an organization…</option>
            {list.filter((o) => !site.orgs.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
          <Button size="sm" disabled={!pick} onClick={() => { setOrgs([...site.orgs, pick]); setPick(''); }}>Add</Button>
        </div>
      )}
      {orgs.error ? <p className="small text-warning">Organizations could not be listed.</p> : null}
    </Card>
  );
}
