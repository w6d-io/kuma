import { useMemo, useState } from 'react';
import type { GroupsMap, RouteEntry } from '../../api/types';
import type { SiteRolesWrite } from '../../api/rbacWrites';
import { Badge, Button, Callout, Checkbox, Drawer, EmptyHint, Field, I, Input } from '../../components/ui';
import {
  EVERYTHING, diffRoles, groupsUsingRole, isEverything, permissionCatalogue, validateRoleName,
  type SiteRoles,
} from '../../lib/rbacEdit';
import { plural } from './access';

export interface RoleDraft {
  write: SiteRolesWrite;
  summary: string;
}

/**
 * Create or change one role: its name and its permissions, then a review of exactly what changes and
 * whom it reaches before anything is saved.
 *
 * The permissions offered are what the site's routes ask for, what its roles already carry and what
 * jinbe lists for it, grouped by resource. Anything else can be typed in.
 */
export function RoleEditor({ site, role, roles, groups, routes, known, peopleIn, busy, onSave, onClose }: {
  site: string;
  /** null: a new role. */
  role: string | null;
  roles: SiteRoles;
  groups: GroupsMap;
  routes: RouteEntry[];
  known: string[];
  peopleIn: (groups: string[]) => number | null;
  busy: boolean;
  onSave: (draft: RoleDraft) => void;
  onClose: () => void;
}) {
  const before = role ? roles[role] ?? [] : [];
  const [name, setName] = useState(role ?? '');
  const [everything, setEverything] = useState(isEverything(before));
  const [perms, setPerms] = useState<Set<string>>(() => new Set(before.filter(p => p !== EVERYTHING)));
  const [extra, setExtra] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [filter, setFilter] = useState('');
  const [step, setStep] = useState<'edit' | 'review'>('edit');

  const catalogue = useMemo(() => permissionCatalogue(routes, roles, [...known, ...extra]), [routes, roles, known, extra]);
  const routeUse = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of routes) if (r.permission) m.set(r.permission, (m.get(r.permission) ?? 0) + 1);
    return m;
  }, [routes]);
  const byResource = useMemo(() => {
    const low = filter.trim().toLowerCase();
    const out = new Map<string, string[]>();
    for (const p of catalogue) {
      if (low && !p.toLowerCase().includes(low)) continue;
      const res = p.includes(':') ? p.split(':')[0] : 'other';
      out.set(res, [...(out.get(res) ?? []), p]);
    }
    return [...out.entries()];
  }, [catalogue, filter]);

  const nameError = validateRoleName(name, Object.keys(roles), role ?? undefined);
  const finalName = name.trim();
  const after = everything ? [EVERYTHING, ...[...perms].sort()] : [...perms].sort();
  const nextRoles: SiteRoles = { ...roles };
  if (role && role !== finalName) delete nextRoles[role];
  nextRoles[finalName] = after;
  const diff = diffRoles(roles, nextRoles);
  const renamed = !!role && role !== finalName;
  const holders = role ? groupsUsingRole(groups, site, role) : [];
  const people = peopleIn(holders);

  const toggle = (p: string, on: boolean) => setPerms(s => {
    const n = new Set(s);
    if (on) n.add(p); else n.delete(p);
    return n;
  });
  const addCustom = () => {
    const p = custom.trim();
    if (!p || p === EVERYTHING) return;
    setExtra(x => (x.includes(p) ? x : [...x, p]));
    toggle(p, true);
    setCustom('');
  };

  const save = () => onSave({
    write: {
      site,
      upsert: { name: finalName, permissions: after },
      rename: renamed ? { from: role!, to: finalName } : undefined,
    },
    summary: role ? `role ${finalName} on ${site}` : `new role ${finalName} on ${site}`,
  });

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={site}
      title={role ? `Edit role ${role}` : 'New role'}
      size="lg"
      footer={step === 'edit' ? (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!nameError || diff.empty} onClick={() => setStep('review')}>Review changes</Button>
        </>
      ) : (
        <>
          <Button onClick={() => setStep('edit')} disabled={busy}>Back</Button>
          <Button variant="primary" loading={busy} onClick={save}>Save roles</Button>
        </>
      )}
    >
      {step === 'edit' ? (
        <div className="col gap-16">
          <Field label="Name" htmlFor="role-name" error={name && nameError} hint="Lowercase, e.g. payslips-editor">
            <Input id="role-name" mono value={name} onChange={e => setName(e.target.value)} autoFocus={!role} />
          </Field>
          <Checkbox
            checked={everything}
            onChange={setEverything}
            label={<strong>Everything in this site</strong>}
            hint="Every route of the site, now and later — except the organization routes, which follow org grants."
          />
          <div className="col gap-8">
            <div className="row wrap gap-8 items-end">
              <Field label="Permissions" htmlFor="role-filter" className="flex-1">
                <Input id="role-filter" leading={I.search} placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
              </Field>
              <span className="small muted">{plural(perms.size, 'permission')} picked</span>
            </div>
            {everything && <div className="small muted">Picked permissions are kept, but everything already covers them.</div>}
            {byResource.length === 0 && <EmptyHint>No permission matches.</EmptyHint>}
            {byResource.map(([res, list]) => (
              <fieldset key={res} className="rb-perm-set">
                <legend className="eyebrow">{res}</legend>
                <div className="rb-perm-grid">
                  {list.map(p => (
                    <Checkbox
                      key={p}
                      checked={perms.has(p)}
                      onChange={on => toggle(p, on)}
                      label={<span className="mono">{p}</span>}
                      hint={routeUse.get(p) ? plural(routeUse.get(p)!, 'route') : 'no route needs it'}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="row gap-8">
              <Input
                aria-label="Custom permission"
                mono
                placeholder="resource:verb"
                value={custom}
                onChange={e => setCustom(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
              />
              <Button icon={I.plus} onClick={addCustom} disabled={!custom.trim()}>Add</Button>
            </div>
          </div>
        </div>
      ) : (
        <RoleReview
          site={site}
          role={role}
          finalName={finalName}
          renamed={renamed}
          before={before}
          after={after}
          holders={holders}
          people={people}
        />
      )}
    </Drawer>
  );
}

function RoleReview({ site, role, finalName, renamed, before, after, holders, people }: {
  site: string;
  role: string | null;
  finalName: string;
  renamed: boolean;
  before: string[];
  after: string[];
  holders: string[];
  people: number | null;
}) {
  const label = (p: string) => (p === EVERYTHING ? 'Everything in this site' : p);
  const lines = [
    ...after.filter(p => !before.includes(p)).map(p => ({ sign: '+', p: label(p) })),
    ...before.filter(p => !after.includes(p)).map(p => ({ sign: '−', p: label(p) })),
  ];
  return (
    <div className="col gap-12">
      <div className="fw-medium">What changes on {site}</div>
      <ul className="rb-diff">
        {!role && <li className="add">+ role <span className="mono">{finalName}</span></li>}
        {renamed && <li className="chg">renamed <span className="mono">{role}</span> → <span className="mono">{finalName}</span></li>}
        {lines.map(l => (
          <li key={l.sign + l.p} className={l.sign === '+' ? 'add' : 'del'}>{l.sign} <span className="mono">{l.p}</span></li>
        ))}
        {!role && lines.length === 0 && <li className="muted">no permission yet</li>}
      </ul>
      {role ? (
        holders.length > 0 ? (
          <Callout tone="info" icon={I.users}>
            Reaches {people == null ? 'the members of' : plural(people, 'person', 'people') + ' in'}{' '}
            {holders.map((g, i) => <span key={g}>{i > 0 && ', '}<Badge tone="info">{g}</Badge></span>)}.
            {renamed && ' Those groups are moved to the new name first, so nobody loses access in between.'}
          </Callout>
        ) : (
          <span className="small muted">No group gives this role, so nobody is affected yet.</span>
        )
      ) : (
        <span className="small muted">Nobody holds it yet: add it to a group under People → Groups.</span>
      )}
      <span className="small muted">Stored at once; the engines apply it within about 40 seconds.</span>
    </div>
  );
}
