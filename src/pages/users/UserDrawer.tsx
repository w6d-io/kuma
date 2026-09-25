import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../contexts/AppContext';
import { useAuthorizationModel, usePermissionChain, useSession } from '../../api/hooks';
import { api } from '../../api/client';
import { I } from '../../components/ui/Icons';
import { Chip, Avatar, Drawer, Switch } from '../../components/ui/Primitives';
import { useApplyChange } from '../../hooks/useApplyChange';
import { formatHash } from '../../lib/route';
import { permits } from '../../policy/model';
import { SiteGroupRows } from './SiteGroupRows';
import { UserAccessTab } from './UserAccessTab';
import { UserTrail } from './UserTrail';
import { UserProfileTab } from './UserProfileTab';
import { UserSessionsTab } from './UserSessionsTab';
import { UserDangerTab } from './UserDangerTab';

export function UserDrawer() {
  const { userDrawer, setUserDrawer, setPage, state, apiSetUserGroups, apiCreateUser } = useApp();
  const applyChange = useApplyChange();
  const { data: session } = useSession();
  /**
   * What this actor may hand out, asked of the model the engine decides against.
   *
   * What this replaced offered `state.groups` — the previous model's catalogue, read from a cache —
   * and greyed the privileged ones when the session did NOT carry a role literally called
   * `super_admin`. Neither survives: the policy defines no such role (global power is a group
   * granting in every organisation, read off the shape), so every privileged row was greyed for
   * everybody; and the names on offer were not the ones the policy knows, so assigning one wrote a
   * membership that granted nothing while looking like it had worked.
   */
  const modelGroups = useAuthorizationModel().data?.groups ?? {};
  const chain = usePermissionChain();
  const assignable = useQuery({
    queryKey: ['assignable-groups'],
    queryFn: () => api.assignableGroups(),
    staleTime: 30_000,
  });
  const siteRows = {
    offered: assignable.data?.groups ?? [],
    mayAssign: assignable.data?.mayAssign ?? false,
    modelGroups,
    legacy: state.groups,
  };

  // edit state
  const user = userDrawer?.user;
  const [groups, setGroups] = useState(user?.groups || []);
  const [drawerTab, setDrawerTab] = useState("groups");

  // create state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [sendInvite, setSendInvite] = useState(true);

  // Seed the form from the user ONLY when the drawer targets a different user
  // (keyed on id). Deliberately NOT on user?.groups/organizationId: those change
  // on optimistic refetch, and re-seeding would wipe the operator's in-progress
  // edits. eslint-disable is the correct call here, not adding the deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setGroups(userDrawer?.resumeGroups ?? user?.groups ?? []); }, [user?.id]);
  useEffect(() => {
    setDrawerTab("groups");
    setNewEmail(""); setNewName(""); setNewGroups([]); setSendInvite(true);
  }, [userDrawer?.mode, user?.id]);

  if (!userDrawer) return null;

  const toggleGroup = (g: string) => setGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  const toggleNewGroup = (g: string) => setNewGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const saveGroups = () => {
    if (!user) return;
    const changed = JSON.stringify(groups.sort()) !== JSON.stringify((user.groups || []).sort());
    if (!changed) { setUserDrawer(null); return; }
    const summary = `${user.email} → [${groups.join(", ") || "no groups"}]`;
    applyChange(
      "assign",
      summary,
      () => apiSetUserGroups(user.email, groups),
      { kind: 'user-groups', email: user.email, groups },
      // Closed on the WRITE, not on the call. `applyChange` returns before its promise does, so
      // closing on its return discarded the selection on every refusal — which is what made a
      // step-up cost the operator their change.
      () => setUserDrawer(null),
    );
  };

  const create = () => {
    if (!newEmail || !newName) return;
    const ok = applyChange("create", newEmail, () => apiCreateUser({ email: newEmail, name: newName, groups: newGroups, sendInvite }));
    if (ok) setUserDrawer(null);
  };

  // Leaves the drawer for another page. Closed first: on the people page the open person is the address.
  const leaveTo = (go: () => void) => { setUserDrawer(null); go(); };
  // The checker reads its form from the address, so the email rides on it.
  const checkAccess = (email: string) => leaveTo(() => {
    setPage('accesscheck');
    history.replaceState(null, '', `#${formatHash('accesscheck', null, { email })}`);
  });
  const mayCheck = permits(session?.permissions, 'admin:write');

  if (userDrawer.mode === 'create') {
    return (
      <Drawer
        open={true}
        onClose={() => setUserDrawer(null)}
        eyebrow="People"
        title="Create user"
        footer={
          <>
            <span className="small muted">They can sign in once they set a password.</span>
            <div className="row">
              <button className="btn" onClick={() => setUserDrawer(null)}>Cancel</button>
              <button className="btn primary" onClick={create} disabled={!newEmail || !newName}>Create user</button>
            </div>
          </>
        }
      >
        <div className="mb-12">
          <label className="input-label">Email *</label>
          <input className="input mono" type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="user@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
        </div>
        <div className="mb-12">
          <label className="input-label">Full name *</label>
          <input className="input" placeholder="Jane Doe" value={newName} onChange={e => setNewName(e.target.value)} />
        </div>
        {Object.keys(state.groups).length > 0 && (
          <div className="mb-12">
            <label className="input-label">Groups <span className="muted">(optional)</span></label>
            <div className="panel" style={{ padding: 0 }}><SiteGroupRows {...siteRows} checked={newGroups} toggle={toggleNewGroup} /></div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Send invite email</div>
            <div className="small muted">Emails them a link to set their password</div>
          </div>
          <Switch on={sendInvite} onChange={setSendInvite} />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={!!userDrawer}
      onClose={() => setUserDrawer(null)}
      size="lg"
      eyebrow="Edit user"
      title={`Edit · ${user?.name}`}
      footer={
        <>
          <span className="small muted">{drawerTab === "groups" ? "Apply saves site access. Org access is saved on each org's page." : "Changes apply immediately."}</span>
          <div className="row">
            <button className="btn" onClick={() => setUserDrawer(null)}>Cancel</button>
            {drawerTab === "groups" && <button className="btn primary" onClick={saveGroups} disabled={!user}>Apply change</button>}
          </div>
        </>
      }
    >
      {user && (
        <>
          <div className="panel mb-12" style={{ padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar name={user.name} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{user.name}</div>
              <div className="small muted mono">{user.email}</div>
            </div>
            {!user.active && <Chip tone="warn">inactive</Chip>}
            {mayCheck && (
              <button className="btn sm" onClick={() => checkAccess(user.email)} title="Ask whether they can call a route, and why">
                <span style={{ width: 13, height: 13, display: "grid", placeItems: "center" }}>{I.shield}</span> Check access
              </button>
            )}
          </div>
          <div className="drawer-tabs">
            <button className={drawerTab === "groups" ? "on" : ""} onClick={() => setDrawerTab("groups")}>Access</button>
            <button className={drawerTab === "profile" ? "on" : ""} onClick={() => setDrawerTab("profile")}>Edit</button>
            <button className={drawerTab === "sessions" ? "on" : ""} onClick={() => setDrawerTab("sessions")}>Sessions</button>
            <button className={drawerTab === "activity" ? "on" : ""} onClick={() => setDrawerTab("activity")}>Activity</button>
            <button className={drawerTab === "danger" ? "on" : ""} onClick={() => setDrawerTab("danger")}>Danger</button>
          </div>
          {drawerTab === "groups" && (
            <>
              {/* Says why this drawer opened by itself, and that nothing has been written yet. An
                  operator returning from a step-up to a pre-filled form must be able to tell a
                  proposal from something already applied on their behalf. */}
              {userDrawer.resumeGroups && (
                <div className="resumed-change">
                  <span className="resumed-change-icon">{I.check}</span>
                  <div>
                    <strong>Second factor verified · your change is ready</strong>
                    <div className="small muted">
                      Restored from before the re-verification. Nothing has been applied yet —
                      check it and use Apply change.
                    </div>
                  </div>
                </div>
              )}
              <UserAccessTab
                user={user}
                groups={groups}
                toggle={toggleGroup}
                siteRows={siteRows}
                assignable={{ isError: assignable.isError, isLoading: assignable.isLoading }}
                chain={chain}
                onOpenOrg={(orgId) => leaveTo(() => setPage('orgadmin', orgId))}
              />
            </>
          )}
          {drawerTab === "profile" && <UserProfileTab user={user} />}
          {drawerTab === "sessions" && <UserSessionsTab user={user} />}
          {drawerTab === "activity" && <UserTrail user={user} />}
          {drawerTab === "danger" && <UserDangerTab key={user.id} user={user} onDeleted={() => setUserDrawer(null)} />}
        </>
      )}
    </Drawer>
  );
}
