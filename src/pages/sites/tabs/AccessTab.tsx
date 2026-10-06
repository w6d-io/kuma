import { useState } from 'react';
import { Button, Callout, Card, Checkbox, EmptyHint, Field, I, Input, Segmented, Select, Table, Th } from '../../../components/ui';
import { useAllOrganizations, useGroupsMap } from '../../../api/hooks';
import { accessMatrix, declaredPermissions, expandRolePermissions, isWildcard, orgRoleName, PUBLIC, SIGNED_IN } from '../../../lib/sites/access';
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
    <Card pad="none" title={`Who can do what on ${site.displayName}`} sub="Org roles count only on org-scoped routes, in organizations entitled to this site, and never remove site access. People counts arrive with the server matrix.">
      <Table className="site-matrix" aria-label="Access matrix">
        <thead>
          <tr><Th scope="col">Who</Th>{m.columns.map((c) => <Th key={c} scope="col" align="center" className="mono small">{c}</Th>)}</tr>
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
      <div className="px-16"><CheckList lines={notes} /></div>
      <p className="small muted m-0 px-16 py-12">{SIGNED_IN}: any account passes; {PUBLIC}: no sign-in.</p>
    </Card>
  );
}

function RolesView({ site, readOnly, set }: { site: Site; readOnly: boolean; set: (fn: (s: Site) => Site) => void }) {
  const roles = expandRolePermissions(site);
  const preset = typeof site.roles === 'string' ? site.roles : 'custom';
  const needed = [...new Set([...site.routes.items, { access: site.routes.catchAll.access }].flatMap((r) => (r.access.kind === 'permission' ? [r.access.permission] : [])))];
  const perms = [...new Set([...needed, ...Object.values(roles).flat().filter((p) => !isWildcard(p))])].sort();
  const wild = Object.entries(roles).filter(([, held]) => held.some(isWildcard)).map(([role]) => role);
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
        <thead><tr><Th scope="col">Role</Th>{perms.map((p) => <Th key={p} scope="col" align="center" className="mono small">{p}</Th>)}<Th scope="col" align="center"><span className="sr-only">Fill</span></Th></tr></thead>
        <tbody>
          {Object.entries(roles).map(([role, held]) => (
            <tr key={role}>
              <th scope="row" className="mono small">{role}{!mapped.has(role) && <span className="muted"> (unmapped)</span>}</th>
              {perms.map((p) => (
                <td key={p} className="align-center">
                  <Checkbox className="bare" label={<span className="sr-only">{role} {p}</span>} checked={held.includes(p)} disabled={readOnly || preset !== 'custom'} onChange={(on) => toggle(role, p, on)} />
                </td>
              ))}
              <td className="align-center">
                {/* By name, never `*`: a role reaches exactly what it lists. */}
                <Button size="sm" variant="ghost" disabled={readOnly || preset !== 'custom' || (perms.every((p) => held.includes(p)) && !held.some(isWildcard))} aria-label={`${role}: all permissions of this site`} onClick={() => setRoles({ ...roles, [role]: [...perms] })}>All</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {wild.length > 0 && (
        <Callout tone="danger" icon={I.alert}>
          {wild.join(', ')} still {wild.length === 1 ? 'carries' : 'carry'} a wildcard, which jinbe refuses (<span className="mono">wildcard_permission</span>). Use “All” to list
          {' '}{declaredPermissions(site).join(', ') || 'the permissions your routes declare'} instead.
        </Callout>
      )}
      <p className="small muted">A role reaches exactly the permissions it lists. “All” ticks every permission this site declares today; one added later must be ticked too.</p>
      {preset === 'custom' && !readOnly && (
        <div className="row gap-8 wrap">
          <Input size="sm" mono placeholder="new-role" aria-label="New role" value={newRole} onChange={(e) => setNewRole(e.target.value.toLowerCase())} />
          <Button size="sm" icon={I.plus} disabled={!/^[a-z][a-z0-9_-]{0,39}$/.test(newRole) || !!roles[newRole]} onClick={() => { setRoles({ ...roles, [newRole]: [] }); setNewRole(''); }}>Add role</Button>
          <Input size="sm" mono placeholder="reports:export" aria-label="New permission" value={newPerm} onChange={(e) => setNewPerm(e.target.value.trim())} />
          <Button size="sm" icon={I.plus} disabled={!/^[a-z][a-z0-9_.-]*:[a-z][a-z0-9_-]*$/.test(newPerm) || !roles.admin} title="Added to admin; tick it for other roles" onClick={() => { const first = roles.admin ? 'admin' : Object.keys(roles)[0]; toggle(first, newPerm, true); setNewPerm(''); }}>Add permission</Button>
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
  const [fresh, setFresh] = useState('');
  const freshName = `${site.name}-${fresh.trim().toLowerCase()}`;
  const freshOk = /^[a-z0-9][a-z0-9_-]{0,40}$/.test(fresh.trim().toLowerCase()) && !site.groups.platform[freshName] && !site.groups.orgGrantable[freshName];
  const setPlatform = (p: Record<string, string[]>) => set((s) => ({ ...s, groups: { ...s.groups, platform: p } }));
  const setGrantable = (g: Site['groups']['orgGrantable']) => set((s) => ({ ...s, groups: { ...s.groups, orgGrantable: g } }));
  const others = (g: string) => Object.keys(groups.data?.[g] ?? {}).filter((svc) => svc !== site.name).length;

  return (
    <div className="stack gap-16">
      <Card title="Platform groups" sub="Shared groups (people everywhere). Only this site’s part of a group changes here.">
        {Object.keys(site.groups.platform).length === 0 && <EmptyHint>No group mapped: nobody can use {site.displayName}.</EmptyHint>}
        <ul className="site-list">
          {Object.entries(site.groups.platform).map(([g, rs]) => (
            <li key={g} className="row gap-8 items-center wrap">
              <span className="mono fw-medium">{g}</span>
              <span className="muted">→</span>
              <Select size="sm" aria-label={`${g} role`} value={rs[0] ?? ''} disabled={readOnly} onChange={(e) => setPlatform({ ...site.groups.platform, [g]: [e.target.value] })}>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
              {!groups.isLoading && !groups.data?.[g] && (g.startsWith(`${site.name}-`)
                ? <span className="small muted">new — made when this version is published; add people on Users</span>
                : <span className="small text-danger">{g} doesn’t exist — create it on Groups first.</span>)}
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
        {!readOnly && (
          <div className="row gap-8 mt-8 items-center">
            <span className="mono small">{site.name}-</span>
            <Input size="sm" aria-label="New site group name" placeholder="editors" value={fresh} onChange={(e) => setFresh(e.target.value)} />
            <Button size="sm" icon={I.plus} disabled={!freshOk} onClick={() => { setPlatform({ ...site.groups.platform, [freshName]: [roles.includes('user') ? 'user' : roles.includes('viewer') ? 'viewer' : roles[0]] }); setFresh(''); }}>New site group</Button>
          </div>
        )}
      </Card>

      <Card title="Org roles" sub={`Assigned per organization by its owners, as ${site.name}:<role>, to its members — only in organizations entitled to this site, and only by somebody holding every permission the role gives.`}>
        {Object.keys(site.groups.orgGrantable).length === 0 && <EmptyHint>None. Organizations cannot give their members access to {site.displayName}.</EmptyHint>}
        <ul className="site-list">
          {Object.entries(site.groups.orgGrantable).map(([g, def]) => {
            const held = def.roles.flatMap((r) => expandRolePermissions(site)[r] ?? []);
            const named = g.startsWith(`${site.name}-`) && /^[a-z0-9][a-z0-9_-]*$/.test(orgRoleName(site.name, g));
            const lines: CheckLine[] = [
              { level: named ? 'ok' : 'error', text: named ? `assigned as ${site.name}:${orgRoleName(site.name, g)}` : `named ${site.name}-… (lowercase letters, digits, - and _)` },
              { level: held.length > 0 ? 'ok' : 'error', text: held.length > 0 ? `gives ${held.length} permission${held.length === 1 ? '' : 's'}` : 'gives no permission' },
            ];
            return (
              <li key={g} className="stack gap-4">
                <div className="row gap-8 items-center wrap">
                  <span className="mono fw-medium" title={`entry ${g}`}>{site.name}:{orgRoleName(site.name, g)}</span>
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
          <Button size="sm" icon={I.plus} className="mt-8" onClick={() => setGrantable(orgGrantableFor(site.name, site.displayName))}>Create org roles {site.name}:editors and {site.name}:viewers</Button>
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
    <>
    <Card title="Organizations" sub="Which organizations are entitled to this site: its org roles can be assigned in them. Removing one stops those roles counting there; access through platform groups is unchanged.">
      {site.orgs.length === 0 && <EmptyHint>No organization. Only platform groups give access.</EmptyHint>}
      <ul className="site-list">
        {site.orgs.map((id) => (
          <li key={id} className="row gap-8 items-center">
            <span className="fw-medium">{name(id)}</span>
            <a className="small" href={`#/orgadmin/${encodeURIComponent(id)}`}>Its members&apos; roles</a>
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
    <EveryOrgCard site={site} readOnly={readOnly} set={set} />
    </>
  );
}

/**
 * `everyOrg`: what a site role carries into EVERY organization entitled to the site, for whoever holds
 * that role through a platform group — the only way a platform role acts inside organizations. Never
 * more than the role holds (jinbe refuses it: `every_org_beyond_role`).
 */
function EveryOrgCard({ site, readOnly, set }: { site: Site; readOnly: boolean; set: (fn: (s: Site) => Site) => void }) {
  const roles = expandRolePermissions(site);
  const everyOrg = site.everyOrg ?? {};
  const toggle = (role: string, perm: string, on: boolean) => set((s) => {
    const cur = s.everyOrg?.[role] ?? [];
    const next = { ...(s.everyOrg ?? {}), [role]: on ? [...new Set([...cur, perm])].sort() : cur.filter((p) => p !== perm) };
    if (next[role].length === 0) delete next[role];
    const { everyOrg: _drop, ...rest } = s;
    void _drop;
    return Object.keys(next).length ? { ...rest, everyOrg: next } : rest;
  });
  const names = Object.keys(roles).sort();
  return (
    <Card title="In every organization" sub="What holders of a site role (through a platform group) may also do inside every entitled organization. Off by default; never more than the role itself holds.">
      {names.length === 0 && <EmptyHint>This site has no role yet.</EmptyHint>}
      <ul className="site-list">
        {names.map((role) => (
          <li key={role} className="stack gap-4">
            <span className="mono fw-medium">{role}</span>
            {roles[role].length === 0 ? <span className="small muted">carries nothing</span> : (
              <div className="row wrap gap-8">
                {roles[role].filter((p) => !isWildcard(p)).map((p) => (
                  <Checkbox key={p} size="sm" checked={(everyOrg[role] ?? []).includes(p)} disabled={readOnly} onChange={(on) => toggle(role, p, on)} label={<span className="mono small">{p}</span>} />
                ))}
              </div>
            )}
            {(everyOrg[role] ?? []).filter((p) => !roles[role]?.includes(p)).length > 0 && (
              <span className="small text-danger">Beyond what {role} holds: {(everyOrg[role] ?? []).filter((p) => !roles[role]?.includes(p)).join(', ')}. jinbe refuses it.</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
