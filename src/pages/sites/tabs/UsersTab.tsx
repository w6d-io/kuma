import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../../contexts/AppContext';
import { sitesApi } from '../../../api/sites';
import { stepUpOnRefusal } from '../../../lib/resume';
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, EmptyRow, Field, FieldRow, I, Input, LoadingRows, RadioGroup, Select, Table } from '../../../components/ui';
import { expandRolePermissions } from '../../../lib/sites/access';
import { REACH_WORDS, defaultSignUp, signUpReach } from '../../../lib/sites/signup';
import type { Site, SiteSignUp } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';
import { useSitePerms } from '../usePerms';

/**
 * Users: public sign-up through this site (jinbe sites/signup). Who may create an account from its
 * sign-in page, the site roles they get (the `<site>-users` group), the organization they land in,
 * what that lets them do here, and the people who joined. Edited in the draft like everything else;
 * publishing a version that opens or widens sign-up also needs sites.signup:write.
 */

const MODES: Array<{ value: SiteSignUp['mode']; label: string; hint: string }> = [
  { value: 'closed', label: 'Closed', hint: 'Nobody signs up here; who already joined keeps access' },
  { value: 'open', label: 'Open to anyone', hint: 'Any address the platform does not block (disposable providers, the deny list)' },
  { value: 'domains', label: 'Only some email domains', hint: 'People whose address ends with one of the domains below' },
];

const ORGS: Array<{ value: SiteSignUp['orgs']; label: string; hint: string }> = [
  { value: 'personal', label: 'Their own organization', hint: 'Each new person owns one (named after the Company field, or “Jane’s organization”) and can invite colleagues' },
  { value: 'domain', label: 'Their company’s, by email domain', hint: 'Joins the organization that proved it owns the address’s domain (DNS record); otherwise their own' },
  { value: 'invite', label: 'Only by invitation', hint: 'No organization at sign-up; an organization owner invites them' },
  { value: 'none', label: 'No organization', hint: 'Individuals: sign-up gives the site roles only' },
];

export function UsersTab({ ed, readOnly }: { ed: SiteEditor; readOnly: boolean }) {
  const site = ed.site;
  const perms = useSitePerms();
  if (!site) return <Callout tone="warning" icon={I.alert}>This draft is incomplete.</Callout>;
  const signUp = site.signUp;
  const set = (fn: (s: SiteSignUp) => SiteSignUp) => ed.update((s: Site) => ({ ...s, signUp: fn(s.signUp ?? defaultSignUp(s)) }));

  return (
    <div className="stack gap-16">
      <Callout tone="neutral" icon={I.users} title="Public sign-up through this site">
        People can create an account from this site’s sign-in page and get the roles you choose here, on this site only. The platform’s own sign-up (Settings → Sign-in) stays as it is. They join once their email address is verified; somebody who already has an account joins with one click (“Continue to {site.displayName}”).
      </Callout>

      {!signUp ? (
        <Card title="Sign-up" sub="Not set up: nobody can sign up through this site.">
          {!readOnly && <Button variant="primary" icon={I.plus} onClick={() => set((s) => s)}>Set up sign-up</Button>}
        </Card>
      ) : (
        <SignUpSettings site={site} signUp={signUp} set={set} readOnly={readOnly} canOpen={perms.canOpenSignUp} />
      )}

      {perms.canManageMembers && !ed.neverSaved && <SitePeople name={ed.name} pushToastSite={site.displayName} />}
      {signUp && <WhatUsersCanDo site={site} roles={signUp.roles} />}
      {signUp && perms.canSeeMembers && !ed.neverSaved && <Members name={ed.name} canRevoke={perms.canRevokeSignUp} />}
    </div>
  );
}

function SignUpSettings({ site, signUp, set, readOnly, canOpen }: { site: Site; signUp: SiteSignUp; set: (fn: (s: SiteSignUp) => SiteSignUp) => void; readOnly: boolean; canOpen: boolean }) {
  const roles = Object.keys(expandRolePermissions(site)).sort();
  const [domainsText, setDomainsText] = useState(signUp.domains.join(', '));
  const parseDomains = (text: string) => [...new Set(text.split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];

  return (
    <Card title="Sign-up" sub="Saved in the draft; visitors see it once the version is applied.">
      <div className="stack gap-12">
        {signUp.mode !== 'closed' && !canOpen && (
          <Callout tone="warning" icon={I.lock}>Publishing a version that opens or widens sign-up needs <span className="mono">sites.signup:write</span>. You can prepare it; somebody who holds it applies it.</Callout>
        )}
        <RadioGroup<SiteSignUp['mode']> label="Who can sign up" name="signup-mode" value={signUp.mode} disabled={readOnly} onChange={(mode) => set((s) => ({ ...s, mode }))} options={MODES} />
        {signUp.mode === 'domains' && (
          <Field label="Email domains" hint="Separated by commas, like client.com, partner.org">
            <Input value={domainsText} disabled={readOnly} onChange={(e) => setDomainsText(e.target.value)} onBlur={() => set((s) => ({ ...s, domains: parseDomains(domainsText) }))} />
          </Field>
        )}
        <fieldset className="site-fieldset">
          <legend className="small fw-medium">Roles they get on {site.displayName}</legend>
          <div className="row wrap gap-12">
            {roles.map((r) => (
              <Checkbox key={r} disabled={readOnly} label={<span className="mono small">{r}</span>} checked={signUp.roles.includes(r)} onChange={(on) => set((s) => ({ ...s, roles: on ? [...s.roles, r] : s.roles.filter((x) => x !== r) }))} />
            ))}
          </div>
          {signUp.roles.includes('admin') && <p className="small text-warning m-0">Everybody who signs up would be an admin of this site.</p>}
          {signUp.roles.length === 0 && <p className="small text-warning m-0">Pick at least one role: without one, sign-up stays closed.</p>}
        </fieldset>
        <RadioGroup<SiteSignUp['orgs']> label="Organization" name="signup-orgs" value={signUp.orgs} disabled={readOnly} onChange={(orgs) => set((s) => ({ ...s, orgs }))} options={ORGS} />
      </div>
    </Card>
  );
}

function WhatUsersCanDo({ site, roles }: { site: Site; roles: string[] }) {
  const rows = signUpReach(site, roles);
  const orgRoles = Object.entries(site.groups.orgGrantable);
  return (
    <Card title="What can a user do" sub={`What one signed-up person reaches on ${site.displayName} with ${roles.length ? roles.join(', ') : 'no role'}. Change it on Routes and Access.`} pad="none">
      <Table>
        <thead><tr><th>Route</th><th>Reached</th><th className="mono">Permission asked</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono small">{r.label}</td>
              <td>{r.reach === 'no' ? <Badge tone="plain">No</Badge> : <Badge tone={r.reach === 'role' ? 'info' : 'plain'}>{REACH_WORDS[r.reach]}{r.via.length ? ` ${r.via.join(', ')}` : ''}</Badge>}</td>
              <td className="mono small">{r.permission ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {orgRoles.length > 0 && (
        <p className="small muted m-0 p-12">
          Inside their organization, its owner can also hand out: {orgRoles.map(([, d]) => `${d.label} (${d.roles.join(', ')})`).join('; ')}.
        </p>
      )}
    </Card>
  );
}

function Members({ name, canRevoke }: { name: string; canRevoke: boolean }) {
  const { pushToast } = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sites', 'signup-members', name], queryFn: () => sitesApi.signUpMembers(name) });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['sites', 'signup-members', name] });

  async function remove(id: string, email: string | null) {
    setBusy(id);
    try {
      await sitesApi.removeSignUpMember(name, id);
      pushToast('Removed from this site', { sub: email ?? id });
      await refresh();
    } catch (e: unknown) {
      pushToast((e as Error).message || 'Could not remove', { err: true });
    } finally {
      setBusy(null);
    }
  }
  async function removeAll() {
    setBusy('all');
    try {
      const r = await sitesApi.removeAllSignUpMembers(name);
      pushToast(`Removed ${r.removed} ${r.removed === 1 ? 'person' : 'people'} from this site`);
      await refresh();
    } catch (e: unknown) {
      if (!stepUpOnRefusal(e, pushToast, { redo: 'Press “Remove everyone” again: nobody was removed before the check.' })) pushToast((e as Error).message || 'Could not remove', { err: true });
    } finally {
      setBusy(null);
      setConfirmAll(false);
    }
  }

  const total = q.data?.total ?? 0;
  return (
    <Card title="People who signed up" sub={q.data ? `${total} ${total === 1 ? 'person' : 'people'} in ${q.data.group}${total > q.data.members.length ? `, ${q.data.members.length} shown` : ''}` : undefined} pad="none"
      actions={canRevoke && total > 0 ? <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmAll(true)}>Remove everyone</Button> : undefined}>
      <Table>
        <thead><tr><th>Person</th><th>Organization</th><th>Account created</th><th className="actions" /></tr></thead>
        <tbody>
          {q.isLoading && <LoadingRows rows={3} cols={4} />}
          {q.isError && <EmptyRow colSpan={4}>Could not load who signed up.</EmptyRow>}
          {q.data && q.data.members.length === 0 && <EmptyRow colSpan={4}>Nobody has signed up through this site yet.</EmptyRow>}
          {q.data?.members.map((m) => (
            <tr key={m.id}>
              <td>{m.name ? <>{m.name} <span className="muted small">{m.email}</span></> : <span>{m.email ?? m.id}</span>}</td>
              <td className="small">{m.organizations.map((o) => o.name ?? o.id).join(', ') || '—'}</td>
              <td className="small">{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '—'}</td>
              <td className="actions">{canRevoke && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => remove(m.id, m.email)}>Remove</Button>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ConfirmDialog
        open={confirmAll}
        title="Remove everyone who signed up?"
        danger
        confirmLabel="Remove everyone"
        blastRadius={<>All {total} people lose what sign-up gave them on this site. Their accounts and organizations stay. Close sign-up first, or new people keep joining.</>}
        requireText="REMOVE"
        busy={busy === 'all'}
        onConfirm={removeAll}
        onCancel={() => setConfirmAll(false)}
      />
    </Card>
  );
}

/**
 * People in the site's own groups (<site>-…, the sign-up group included, as published): who uses the
 * site and with which roles. Adding needs an existing account; a group that requires two-step sign-in
 * refuses somebody without a second factor (jinbe says so).
 */
function SitePeople({ name, pushToastSite }: { name: string; pushToastSite: string }) {
  const { pushToast } = useApp();
  const qc = useQueryClient();
  const key = ['sites', 'members', name];
  const q = useQuery({ queryKey: key, queryFn: () => sitesApi.siteMembers(name) });
  const [email, setEmail] = useState('');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const groups = q.data?.groups ?? [];
  const target = group || groups[0]?.group || '';

  async function add() {
    setBusy('add');
    try {
      const r = await sitesApi.addSiteMember(name, target, email.trim());
      pushToast(r.added ? `Added to ${target}` : `Already in ${target}`, { sub: email.trim() });
      setEmail('');
      await qc.invalidateQueries({ queryKey: key });
    } catch (e: unknown) {
      pushToast((e as Error).message || 'Could not add', { err: true });
    } finally {
      setBusy(null);
    }
  }
  async function remove(g: string, id: string, who: string) {
    setBusy(id + g);
    try {
      await sitesApi.removeSiteMember(name, g, id);
      pushToast(`Removed from ${g}`, { sub: who });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e: unknown) {
      pushToast((e as Error).message || 'Could not remove', { err: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="People" sub={`Who uses ${pushToastSite}: the people in its own groups and the roles each group gives here.`} pad="none">
      {q.isError && <p className="small text-warning p-12 m-0">Could not load the site’s groups (published version only).</p>}
      {q.data && groups.length === 0 && <p className="small muted p-12 m-0">This site has no group of its own yet: add one named {name}-… on Access (or open sign-up), then publish.</p>}
      <Table>
        <thead><tr><th>Group</th><th>Roles here</th><th>Person</th><th className="actions" /></tr></thead>
        <tbody>
          {q.isLoading && <LoadingRows rows={3} cols={4} />}
          {groups.flatMap((g) => (g.members.length ? g.members : [null]).map((m, i) => (
            <tr key={`${g.group}-${m?.id ?? 'empty'}`}>
              <td className="mono small">{i === 0 ? <>{g.group}{g.signUp && <Badge tone="plain"> sign-up</Badge>}</> : ''}</td>
              <td className="mono small">{i === 0 ? g.roles.join(', ') : ''}</td>
              <td>{m ? (m.name ? <>{m.name} <span className="muted small">{m.email}</span></> : (m.email ?? m.id)) : <span className="muted small">nobody yet</span>}</td>
              <td className="actions">{m && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => remove(g.group, m.id, m.email ?? m.id)}>Remove</Button>}</td>
            </tr>
          )))}
        </tbody>
      </Table>
      {groups.length > 0 && (
        <FieldRow className="p-12">
          <Field label="Add a person" hint="Their account must exist (they sign up, or support invites them)">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </Field>
          <Field label="To group">
            <Select value={target} onChange={(e) => setGroup(e.target.value)}>
              {groups.map((g) => <option key={g.group} value={g.group}>{g.group}</option>)}
            </Select>
          </Field>
          <Button icon={I.plus} disabled={!email.includes('@') || !target || busy !== null} onClick={add}>Add</Button>
        </FieldRow>
      )}
    </Card>
  );
}
