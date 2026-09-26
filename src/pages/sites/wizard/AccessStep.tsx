import { useEffect, useState } from 'react';
import { Button, Checkbox, Field, I, Select, Switch } from '../../../components/ui';
import { useAllOrganizations, useGroupsMap } from '../../../api/hooks';
import { presetRoles } from '../../../lib/sites/access';
import { STANDARD_GROUPS } from '../../../lib/sites/templates';
import type { WizardState } from '../../../lib/sites/wizard';
import type { RolesPreset } from '../../../lib/sites/types';

/**
 * Step 3 — Access (site-ux.md §4.3): the role set, which platform groups get which role, and
 * whether organizations can use the site (with org-grantable groups created for it). Only groups
 * that exist are offered; a missing default says so.
 */

export function AccessStep({ s, patch }: { s: WizardState; patch: (p: Partial<WizardState>) => void }) {
  const groups = useGroupsMap();
  const orgs = useAllOrganizations();
  const [pick, setPick] = useState('');
  const [orgPick, setOrgPick] = useState('');
  const roles = Object.keys(presetRoles(s.name || 'site')[s.roles]);
  const existing = Object.keys(groups.data ?? {});

  // First visit: map the standard groups that exist.
  useEffect(() => {
    if (!groups.data || Object.keys(s.groups).length > 0) return;
    const defaults = Object.fromEntries(Object.entries(STANDARD_GROUPS).filter(([g, r]) => groups.data![g] && roles.includes(r)));
    if (Object.keys(defaults).length) patch({ groups: defaults });
  }, [groups.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const orgList = orgs.data?.organizations ?? [];
  const missing = Object.keys(STANDARD_GROUPS).filter((g) => groups.data && !groups.data[g]);

  return (
    <div className="stack gap-16">
      <Field label="Roles" hint="admin = everything · editor = read + write · viewer = read. Customize later on Access.">
        <Select value={s.roles} onChange={(e) => patch({ roles: e.target.value as RolesPreset })}>
          <option value="standard">Standard: admin · editor · viewer</option>
          <option value="readonly">Read-only: viewer</option>
          <option value="operator">Operator: admin · operator · editor · viewer</option>
        </Select>
      </Field>

      <fieldset className="site-fieldset">
        <legend className="fw-medium">Platform groups (people everywhere)</legend>
        <ul className="site-list">
          {Object.entries(s.groups).map(([g, r]) => (
            <li key={g} className="row gap-8 items-center">
              <span className="mono">{g}</span><span className="muted">→</span>
              <Select size="sm" aria-label={`${g} role`} value={r} onChange={(e) => patch({ groups: { ...s.groups, [g]: e.target.value } })}>
                <option value="">no access</option>
                {roles.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
              <Button size="sm" variant="ghost" iconOnly icon={I.close} aria-label={`Remove ${g}`} onClick={() => { const n = { ...s.groups }; delete n[g]; patch({ groups: n }); }} />
            </li>
          ))}
        </ul>
        {missing.length > 0 && <p className="small muted m-0">{missing.join(', ')} {missing.length === 1 ? 'doesn’t' : 'don’t'} exist — create {missing.length === 1 ? 'it' : 'them'} on Groups to map {missing.length === 1 ? 'it' : 'them'}.</p>}
        <div className="row gap-8 mt-8">
          <Select size="sm" aria-label="Add a group" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">+ add a group…</option>
            {existing.filter((g) => !(g in s.groups)).map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
          <Button size="sm" disabled={!pick} onClick={() => { patch({ groups: { ...s.groups, [pick]: roles.includes('viewer') ? 'viewer' : roles[0] } }); setPick(''); }}>Map</Button>
        </div>
      </fieldset>

      <fieldset className="site-fieldset">
        <legend className="fw-medium">Organizations</legend>
        <Field label="Make it available to organizations" inline>
          <Switch on={s.orgsOn} label="Available to organizations" onChange={(on) => patch({ orgsOn: on })} />
        </Field>
        {s.orgsOn && (
          <div className="stack gap-8">
            <div className="pills">
              {s.orgs.map((id) => (
                <span key={id} className="pill">{orgList.find((o) => o.id === id)?.name ?? id}
                  <Button size="sm" variant="ghost" iconOnly icon={I.close} aria-label="Remove" onClick={() => patch({ orgs: s.orgs.filter((x) => x !== id) })} />
                </span>
              ))}
            </div>
            <div className="row gap-8">
              <Select size="sm" aria-label="Pick an organization" value={orgPick} onChange={(e) => setOrgPick(e.target.value)}>
                <option value="">+ pick…</option>
                {orgList.filter((o) => !s.orgs.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <Button size="sm" disabled={!orgPick} onClick={() => { patch({ orgs: [...s.orgs, orgPick] }); setOrgPick(''); }}>Add</Button>
            </div>
            <Checkbox
              checked={s.orgGrantable}
              onChange={(on) => patch({ orgGrantable: on })}
              label={`Org admins can give their members ${s.displayName || s.name} ${s.roles === 'readonly' ? 'viewers' : 'editors and viewers'}`}
              hint="Created for you, org-grantable. admin can’t be handed out by org admins (it includes everything)."
            />
          </div>
        )}
      </fieldset>
      <p className="small m-0">Sign-in uses the platform sign-in (password, passkeys…). Per-site 2FA and branding are on the site’s Login tab.</p>
    </div>
  );
}
