import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession, useUserSearch } from '../api/hooks';
import { AccessLevel } from '../components/ui/Primitives';
import { SiteAccessTree } from './access/SiteAccessTree';
import { useSiteGroups } from './access/access';
import { groupOutcome } from '../lib/rbacEdit';
import { Avatar, Badge, Button, ButtonBase, Callout, Card, Checkbox, Drawer, Field, I, Input, Stepper, cx } from '../components/ui';
import { accessLevelOf } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';
import { searchedToUser } from '../api/transforms';
import type { GroupsMap, RolesMap, User } from '../api/types';
import { PRIVILEGED_MUTATION, permits } from '../policy/model';

// Intent-first "Grant access" wizard. The RBAC data model is service → role →
// group → user; the old assign drawer made an operator assemble that graph by
// hand (and picked the person from a <select> of the ENTIRE directory). This
// flow inverts it: start from a PERSON and an OUTCOME ("what should they be
// able to do?"), and the tool shows the resulting permissions before you apply.
//
// Three steps:
//   1. Who    — server-side search (no full-directory pull; exact-email fast
//               path + name filter over loaded pages + load-more).
//   2. What   — groups framed as outcomes: each shows the access level and the
//               permissions it actually grants, searchable by group / service /
//               permission. Privilege-escalation + MFA gating mirrors jinbe.
//   3. Review — before/after diff + the live resulting-access PermTree, then
//               apply via the same setUserGroups (PUT-replace) path.

// Small debounce so typing doesn't re-query the server on every keystroke
// (mirrors Users.tsx).
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Step = 'who' | 'what' | 'review';

/** What a group grants, from the site groups and roles jinbe serves the engine. */
function outcomeOf(group: string, groups: GroupsMap, roles: RolesMap, privileged: (g: string) => boolean) {
  const o = groupOutcome(groups[group], roles);
  return {
    g: group,
    perms: o.permissions,
    unknownRoles: o.unknownRoles,
    sites: o.access.map((a) => a.site),
    summary: o.summary,
    level: o.permissions.length === 0 ? 'none' : o.access.some((a) => a.everything) ? 'admin' : accessLevelOf(o.permissions),
    privileged: privileged(group),
  };
}

export function GrantAccess() {
  const { grant, setGrant, apiSetUserGroups, setUserDrawer, state } = useApp();
  const applyChange = useApplyChange();
  const { data: session } = useSession();
  // Mirror of jinbe's escalation guard: handing out a group that administers the platform needs the
  // permission below. jinbe refuses with 422 either way; this only greys the control and says why.
  const mayGrantPrivileged = permits(session?.permissions, PRIVILEGED_MUTATION);
  // The same site groups Groups edits, so what is offered is what the mutation accepts.
  const siteGroups = useSiteGroups();

  const [step, setStep] = useState<Step>('who');
  const [selected, setSelected] = useState<User | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [pq, setPq] = useState(''); // person search
  const [gq, setGq] = useState(''); // outcome / group search

  // Person search: server-side substring match over email + name (cached
  // in-memory; no directory pull). Fires for >=2 chars.
  const dpq = useDebounced(pq.trim());
  const searching = dpq.length >= 2;
  const searchQ = useUserSearch(dpq);

  // Seed state each time the wizard opens. If launched against a specific user
  // (from a row action), skip the picker and land on "What".
  useEffect(() => {
    if (!grant) return;
    const u = grant.user ?? null;
    setSelected(u);
    setGroups(u?.groups ?? []);
    setStep(u ? 'what' : 'who');
    setPq('');
    setGq('');
    // Reseed only when the wizard is (re)opened, not on every cache tick.
  }, [grant]);

  const matches = useMemo<User[]>(
    () => (searching ? (searchQ.data ?? []).map(searchedToUser) : []),
    [searching, searchQ.data],
  );

  // Groups as outcomes, with the permissions each one grants, filterable by
  // group name, a service it touches, or a permission it confers (so typing
  // "billing" or "delete" surfaces the groups that do that).
  const outcomes = useMemo(() => {
    const low = gq.trim().toLowerCase();
    // What this actor may hand out, plus anything the person already holds — a membership that is
    // no longer offered must stay visible and removable, or it becomes impossible to take away.
    const names = [...new Set([...siteGroups.offered, ...(selected?.groups ?? [])])].sort();
    return names
      .map((g) => outcomeOf(g, state.groups, state.roles, siteGroups.privileged))
      .filter((o) => {
        if (!low) return true;
        return (
          o.g.toLowerCase().includes(low) ||
          o.summary.toLowerCase().includes(low) ||
          o.sites.some((site) => site.toLowerCase().includes(low)) ||
          o.perms.some((p) => p.toLowerCase().includes(low))
        );
      });
  }, [state.groups, state.roles, siteGroups, selected, gq]);

  if (!grant) return null;

  const user = selected;
  const before = new Set(user?.groups ?? []);
  const added = groups.filter((g) => !before.has(g));
  const removed = [...before].filter((g) => !groups.includes(g));
  const changed = added.length > 0 || removed.length > 0;

  // A newly-added privileged group is what triggers the gates (holding one you
  // already have is fine — this is about escalation, not the status quo).
  const escalating = groups.filter((g) => !before.has(g) && siteGroups.privileged(g));
  const actorBlock = escalating.length > 0 && !mayGrantPrivileged;
  const mfaBlock = escalating.length > 0 && user?.mfa === false;

  const pick = (u: User) => {
    setSelected(u);
    setGroups(u.groups ?? []);
    setStep('what');
  };

  const toggle = (g: string) =>
    setGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const apply = () => {
    if (!user || !changed || actorBlock || mfaBlock) return;
    const summary = `${user.email} → [${groups.join(', ') || 'no groups'}]`;
    applyChange(
      'assign',
      summary,
      () => apiSetUserGroups(user.email, groups),
      { kind: 'user-groups', email: user.email, groups },
      () => setGrant(null),
    );
  };

  const goStep = (s: Step) => {
    if (s !== 'who' && !user) return; // can't advance without a person
    setStep(s);
  };

  const STEPS: { id: Step; label: string }[] = [
    { id: 'who', label: 'Who' },
    { id: 'what', label: 'What' },
    { id: 'review', label: 'Review' },
  ];
  const stepIdx = STEPS.findIndex((s) => s.id === step);

  return (
    <Drawer
      open={!!grant}
      onClose={() => setGrant(null)}
      size="lg"
      eyebrow="Grant access"
      title={user ? `Grant access · ${user.name}` : 'Grant access'}
      footer={
        <>
          <div />
          <div className="row">
            <Button onClick={() => setGrant(null)}>Cancel</Button>
            {step !== 'who' && (
              <Button onClick={() => goStep(STEPS[stepIdx - 1].id)}>Back</Button>
            )}
            {/* The step list only goes back; after "Change", this is the way forward again. */}
            {step === 'who' && user && (
              <Button variant="primary" onClick={() => goStep('what')}>Next</Button>
            )}
            {step === 'what' && (
              <Button variant="primary" disabled={!user} onClick={() => goStep('review')}>Review</Button>
            )}
            {step === 'review' && (
              <Button
                variant="primary"
                disabled={!user || !changed || actorBlock || mfaBlock}
                onClick={apply}
              >
                Apply access
              </Button>
            )}
          </div>
        </>
      }
    >
      <Stepper className="mb-12" steps={STEPS} current={step} onStep={(id) => goStep(id as Step)} />

      {/* Selected-person banner (visible on What / Review) */}
      {user && step !== 'who' && (
        <Card pad="sm" className="mb-12">
          <div className="row gap-12">
            <Avatar name={user.name} size={34} />
            <div className="flex-1">
              <div className="fw-medium">{user.name}</div>
              <div className="small muted mono">{user.email}</div>
            </div>
            {user.mfa === false && <Badge tone="warning" title="No second factor enrolled"><span className="chip-ico">{I.alert}</span>no 2FA</Badge>}
            {!user.active && <Badge tone="warning">inactive</Badge>}
            <Button variant="ghost" size="sm" onClick={() => setStep('who')}>Change</Button>
          </div>
        </Card>
      )}

      {/* ── Step 1: Who ── */}
      {step === 'who' && (
        <>
          <Field label="Who are you granting access to?" className="mb-8">
            <Input
              leading={I.search}
              autoFocus
              placeholder="Search by name, or type a full email…"
              value={pq}
              onChange={(e) => setPq(e.target.value)}
            />
          </Field>
          <Card className="ga-list">
            {!searching && <div className="small muted p-12">Type at least 2 characters to search by name or email.</div>}
            {searching && searchQ.isLoading && <div className="small muted p-12">Searching…</div>}
            {searching && !searchQ.isLoading && matches.length === 0 && (
              <div className="small muted p-12">
                No one matches “{dpq}”.{' '}
                <Button variant="ghost" size="sm" onClick={() => { setGrant(null); setUserDrawer({ mode: 'create' }); }}>Invite someone new</Button>
              </div>
            )}
            {matches.map((u) => (
              <ButtonBase key={u.id} onClick={() => pick(u)} className="ga-row ga-person">
                <Avatar name={u.name} />
                <div className="flex-1 min-w-0">
                  <div className="fw-medium text-base">{u.name} {!u.active && <Badge tone="warning">inactive</Badge>}</div>
                  <div className="small muted mono truncate">{u.email}</div>
                </div>
                <div className="ga-person-groups">
                  {u.groups.length === 0
                    ? <span className="small muted">no access</span>
                    : u.groups.slice(0, 3).map((g) => <Badge key={g}>{g}</Badge>)}
                  {u.groups.length > 3 && <span className="small muted">+{u.groups.length - 3}</span>}
                </div>
                <span className="text-disabled">{I.chev}</span>
              </ButtonBase>
            ))}
          </Card>
          {searching && matches.length >= 50 && (
            <div className="small muted py-8 px-2">Showing the first 50 — refine your search to narrow it.</div>
          )}
        </>
      )}

      {/* ── Step 2: What ── */}
      {step === 'what' && user && (
        <>
          <Field
            label="What should they be able to do?"
            hint={<>Pick one or more outcomes. Each grants a bundle of permissions — search by role area, service, or a permission like <span className="mono">billing:read</span>.</>}
            className="mb-8"
          >
            <Input
              leading={I.search}
              placeholder="Filter outcomes…"
              value={gq}
              onChange={(e) => setGq(e.target.value)}
            />
          </Field>
          <Card className="ga-list tall">
            {outcomes.length === 0 && (
              <div className="small muted p-12">
                No group matches “{gq}”. Groups are managed under People → Groups.
              </div>
            )}
            {outcomes.map((o) => {
              const on = groups.includes(o.g);
              const blockedByActor = o.privileged && !mayGrantPrivileged && !on;
              const blockedByMfa = o.privileged && user.mfa === false && !on;
              const blocked = blockedByActor || blockedByMfa;
              const title = blockedByActor
                ? `“${o.g}” administers the platform. Assigning it needs admin.membership:write.`
                : blockedByMfa
                ? `“${o.g}” grants admin privileges. ${user.name} must enroll a second factor (TOTP / security key / backup codes) first.`
                : undefined;
              return (
                <div key={o.g} title={title} className={cx('ga-row ga-outcome', on && 'on')}>
                  <Checkbox
                    checked={on}
                    disabled={blocked}
                    onChange={() => { if (!blocked) toggle(o.g); }}
                    label={
                      <>
                        <span className="row">
                          <span className="fw-medium text-base flex-1">
                            {o.g}
                            {o.privileged && <Badge tone="warning" title="Gives everything on a system site"><span className="chip-ico">{I.lock}</span>platform admin</Badge>}
                            {blockedByActor && <Badge tone="danger">needs admin.membership:write</Badge>}
                            {blockedByMfa && !blockedByActor && <Badge tone="danger">2FA required</Badge>}
                          </span>
                          <AccessLevel level={o.level} compact />
                        </span>
                        <span className="block mt-4">
                          <span className="block small muted">{o.summary}</span>
                          <span className="row wrap gap-4 mt-4">
                            {o.perms.slice(0, 8).map((p) => <Badge key={p}>{p}</Badge>)}
                            {o.perms.length > 8 && <span className="small muted">+{o.perms.length - 8} more</span>}
                            {/* A role the catalogue does not define grants nothing. Saying so is the
                                difference between "this gives nothing" and "this points at something
                                that is missing". */}
                            {o.unknownRoles.length > 0 && (
                              <Badge tone="danger" title="Named by the group but not defined on that site">
                                undefined role: {o.unknownRoles.join(', ')}
                              </Badge>
                            )}
                          </span>
                        </span>
                      </>
                    }
                  />
                </div>
              );
            })}
          </Card>
        </>
      )}

      {/* ── Step 3: Review ── */}
      {step === 'review' && user && (
        <>
          {(actorBlock || mfaBlock) && (
            <Callout tone="danger" icon={I.alert} title="Can't apply — privileged grant blocked" className="mb-12">
              <div className="small text-muted">
                {actorBlock && <>Assigning <b>{escalating.join(', ')}</b> administers the platform; that needs admin.membership:write. </>}
                {mfaBlock && <>{user.name} must enroll a second factor before receiving <b>{escalating.join(', ')}</b>. </>}
                jinbe enforces this regardless (422).
              </div>
            </Callout>
          )}
          <div className="grid g2 items-start">
            <div>
              <label className="input-label">What changes</label>
              <Card pad="sm">
                {!changed && <div className="small muted">No change — {user.name} already has exactly this access.</div>}
                {added.map((g) => (
                  <div key={g} className="row gap-8 mb-4">
                    <Badge tone="success">+ add</Badge><span className="mono small">{g}</span>
                    {siteGroups.privileged(g) && <Badge tone="warning" title="Gives everything on a system site"><span className="chip-ico">{I.lock}</span></Badge>}
                  </div>
                ))}
                {removed.map((g) => (
                  <div key={g} className="row gap-8 mb-4">
                    <Badge tone="danger">− remove</Badge><span className="mono small">{g}</span>
                  </div>
                ))}
                {changed && (
                  <div className="small muted mt-8 leading-relaxed">
                    Result: {groups.length === 0 ? <b>no access</b> : <>member of <b>{groups.join(', ')}</b></>}.
                  </div>
                )}
              </Card>
            </div>
            <div>
              <label className="input-label">Resulting access</label>
              <Card pad="sm">
                <SiteAccessTree user={{ ...user, groups }} />
              </Card>
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}
