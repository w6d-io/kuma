import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSession, useUserSearch } from '../api/hooks';
import { I } from '../components/ui/Icons';
import { Chip, Avatar, Drawer, PermTree, AccessLevel } from '../components/ui/Primitives';
import { accessLevelOf, resolvePerms, isPrivilegedGroup } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';
import { searchedToUser } from '../api/transforms';
import type { User } from '../api/types';

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

/** Resolve the flat permission set a single group would grant. */
function grantsOf(group: string, state: ReturnType<typeof useApp>['state']) {
  const { perms } = resolvePerms({ groups: [group] } as User, state);
  const flat = Object.values(perms).flatMap((s) => [...s]);
  return { flat, services: Object.keys(perms) };
}

export function GrantAccess() {
  const { grant, setGrant, state, apiSetUserGroups, setUserDrawer, setGroupDrawer } = useApp();
  const applyChange = useApplyChange();
  const { data: session } = useSession();
  // Privilege-escalation guard mirror: only super_admin actors can grant groups
  // that confer admin power. jinbe rejects the mutation as 422 either way.
  const actorIsSuperAdmin = (session?.roles || []).includes('super_admin');

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
    return Object.entries(state.groups)
      .map(([g, map]) => {
        const { flat, services } = grantsOf(g, state);
        return {
          g,
          map,
          services,
          perms: [...new Set(flat)],
          level: flat.length === 0 ? 'none' : accessLevelOf(flat),
          privileged: isPrivilegedGroup(g, state),
        };
      })
      .filter((o) => {
        if (!low) return true;
        return (
          o.g.toLowerCase().includes(low) ||
          o.services.some((s) => s.toLowerCase().includes(low)) ||
          o.perms.some((p) => p.toLowerCase().includes(low))
        );
      });
  }, [state, gq]);

  if (!grant) return null;

  const user = selected;
  const before = new Set(user?.groups ?? []);
  const added = groups.filter((g) => !before.has(g));
  const removed = [...before].filter((g) => !groups.includes(g));
  const changed = added.length > 0 || removed.length > 0;

  // A newly-added privileged group is what triggers the gates (holding one you
  // already have is fine — this is about escalation, not the status quo).
  const escalating = groups.filter((g) => !before.has(g) && isPrivilegedGroup(g, state));
  const actorBlock = escalating.length > 0 && !actorIsSuperAdmin;
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
    const ok = applyChange('assign', summary, () => apiSetUserGroups(user.email, groups));
    if (ok) setGrant(null);
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
          <button className="btn ghost sm" onClick={() => { setGrant(null); setGroupDrawer({ mode: 'create' }); }}>
            <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.plus}</span>
            New group
          </button>
          <div className="row">
            <button className="btn" onClick={() => setGrant(null)}>Cancel</button>
            {step !== 'who' && (
              <button className="btn" onClick={() => goStep(STEPS[stepIdx - 1].id)}>Back</button>
            )}
            {step === 'what' && (
              <button className="btn primary" disabled={!user} onClick={() => goStep('review')}>Review</button>
            )}
            {step === 'review' && (
              <button
                className="btn primary"
                disabled={!user || !changed || actorBlock || mfaBlock}
                onClick={apply}
              >
                Apply access
              </button>
            )}
          </div>
        </>
      }
    >
      {/* Stepper */}
      <div className="seg mb-12" role="tablist" style={{ display: 'flex' }}>
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            className={step === s.id ? 'on' : ''}
            disabled={s.id !== 'who' && !user}
            onClick={() => goStep(s.id)}
            style={{ flex: 1 }}
          >
            <span className="mono small" style={{ opacity: 0.6, marginRight: 6 }}>{i + 1}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Selected-person banner (visible on What / Review) */}
      {user && step !== 'who' && (
        <div className="panel mb-12" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar name={user.name} size={34} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{user.name}</div>
            <div className="small muted mono">{user.email}</div>
          </div>
          {user.mfa === false && <Chip tone="warn" title="No second factor enrolled">⚠️ no 2FA</Chip>}
          {!user.active && <Chip tone="warn">inactive</Chip>}
          <button className="btn ghost sm" onClick={() => setStep('who')}>Change</button>
        </div>
      )}

      {/* ── Step 1: Who ── */}
      {step === 'who' && (
        <>
          <label className="input-label">Who are you granting access to?</label>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>{I.search}</span>
            <input
              className="input"
              autoFocus
              style={{ paddingLeft: 30, width: '100%' }}
              placeholder="Search by name, or type a full email…"
              value={pq}
              onChange={(e) => setPq(e.target.value)}
            />
          </div>
          <div className="panel" style={{ padding: 0, maxHeight: 340, overflowY: 'auto' }}>
            {!searching && <div className="small muted" style={{ padding: 14 }}>Type at least 2 characters to search by name or email.</div>}
            {searching && searchQ.isLoading && <div className="small muted" style={{ padding: 14 }}>Searching…</div>}
            {searching && !searchQ.isLoading && matches.length === 0 && (
              <div className="small muted" style={{ padding: 14 }}>
                No one matches “{dpq}”.{' '}
                <button className="btn ghost sm" onClick={() => { setGrant(null); setUserDrawer({ mode: 'create' }); }}>Invite someone new</button>
              </div>
            )}
            {matches.map((u, i) => (
              <button
                key={u.id}
                onClick={() => pick(u)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
                  borderBottom: i < matches.length - 1 ? '1px solid var(--line)' : 'none',
                }}
                className="row-click"
              >
                <Avatar name={u.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 12.5 }}>{u.name} {!u.active && <Chip tone="warn">inactive</Chip>}</div>
                  <div className="small muted mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '45%' }}>
                  {u.groups.length === 0
                    ? <span className="small muted">no access</span>
                    : u.groups.slice(0, 3).map((g) => <Chip key={g}>{g}</Chip>)}
                  {u.groups.length > 3 && <span className="small muted">+{u.groups.length - 3}</span>}
                </div>
                <span style={{ color: 'var(--ink-4)' }}>{I.chev}</span>
              </button>
            ))}
          </div>
          {searching && matches.length >= 50 && (
            <div className="small muted" style={{ padding: '8px 2px' }}>Showing the first 50 — refine your search to narrow it.</div>
          )}
        </>
      )}

      {/* ── Step 2: What ── */}
      {step === 'what' && user && (
        <>
          <label className="input-label">What should they be able to do?</label>
          <div className="small muted" style={{ marginBottom: 8 }}>
            Pick one or more outcomes. Each grants a bundle of permissions — search by role area, service, or a permission like <span className="mono">billing:read</span>.
          </div>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}>{I.search}</span>
            <input
              className="input"
              style={{ paddingLeft: 30, width: '100%' }}
              placeholder="Filter outcomes…"
              value={gq}
              onChange={(e) => setGq(e.target.value)}
            />
          </div>
          <div className="panel" style={{ padding: 0, maxHeight: 380, overflowY: 'auto' }}>
            {outcomes.length === 0 && (
              <div className="small muted" style={{ padding: 14 }}>
                No outcome matches “{gq}”.{' '}
                <button className="btn ghost sm" onClick={() => { setGrant(null); setGroupDrawer({ mode: 'create' }); }}>Create a group</button>
              </div>
            )}
            {outcomes.map((o, i) => {
              const on = groups.includes(o.g);
              const blockedByActor = o.privileged && !actorIsSuperAdmin && !on;
              const blockedByMfa = o.privileged && user.mfa === false && !on;
              const blocked = blockedByActor || blockedByMfa;
              const title = blockedByActor
                ? `“${o.g}” grants admin privileges. Only super_admins may assign it.`
                : blockedByMfa
                ? `“${o.g}” grants admin privileges. ${user.name} must enroll a second factor (TOTP / security key / backup codes) first.`
                : undefined;
              return (
                <label
                  key={o.g}
                  title={title}
                  style={{
                    display: 'block', padding: '12px 14px', cursor: blocked ? 'not-allowed' : 'pointer',
                    background: on ? 'var(--accent-soft)' : 'transparent',
                    borderBottom: i < outcomes.length - 1 ? '1px solid var(--line)' : 'none',
                    opacity: blocked ? 0.55 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" checked={on} disabled={blocked} onChange={() => { if (!blocked) toggle(o.g); }} />
                    <span style={{ fontWeight: 500, fontSize: 12.5, flex: 1 }}>
                      {o.g}
                      {o.privileged && <Chip tone="warn" title="Grants admin power">🔒 privileged</Chip>}
                      {blockedByActor && <Chip tone="err">super_admin only</Chip>}
                      {blockedByMfa && !blockedByActor && <Chip tone="err">2FA required</Chip>}
                    </span>
                    <AccessLevel level={o.level} compact />
                  </div>
                  <div style={{ marginTop: 6, marginLeft: 26, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    <span className="small muted">
                      {o.services.length === 0 ? 'grants nothing' : `on ${o.services.join(', ')} · grants`}
                    </span>
                    {o.perms.includes('*')
                      ? <Chip tone="accent">everything (*)</Chip>
                      : o.perms.slice(0, 8).map((p) => <Chip key={p}>{p}</Chip>)}
                    {!o.perms.includes('*') && o.perms.length > 8 && <span className="small muted">+{o.perms.length - 8} more</span>}
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}

      {/* ── Step 3: Review ── */}
      {step === 'review' && user && (
        <>
          {(actorBlock || mfaBlock) && (
            <div className="panel mb-12" style={{ padding: 12, border: '1px solid var(--red, #ef4444)', color: 'var(--red, #ef4444)' }}>
              <div style={{ fontWeight: 500, fontSize: 12.5 }}>Can't apply — privileged grant blocked</div>
              <div className="small" style={{ marginTop: 4, color: 'var(--ink-2)' }}>
                {actorBlock && <>Assigning <b>{escalating.join(', ')}</b> confers admin power; only a super_admin can grant it. </>}
                {mfaBlock && <>{user.name} must enroll a second factor before receiving <b>{escalating.join(', ')}</b>. </>}
                jinbe enforces this regardless (422).
              </div>
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
            <div>
              <label className="input-label">What changes</label>
              <div className="panel" style={{ padding: 12 }}>
                {!changed && <div className="small muted">No change — {user.name} already has exactly this access.</div>}
                {added.map((g) => (
                  <div key={g} className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Chip tone="ok">+ add</Chip><span className="mono small">{g}</span>
                    {isPrivilegedGroup(g, state) && <Chip tone="warn">🔒</Chip>}
                  </div>
                ))}
                {removed.map((g) => (
                  <div key={g} className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Chip tone="err">− remove</Chip><span className="mono small">{g}</span>
                  </div>
                ))}
                {changed && (
                  <div className="small muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                    Result: {groups.length === 0 ? <b>no access</b> : <>member of <b>{groups.join(', ')}</b></>}.
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="input-label">Resulting access</label>
              <div className="panel" style={{ padding: 12 }}>
                <PermTree user={{ ...user, groups }} state={state} />
              </div>
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}
