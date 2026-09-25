import { useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { ConfirmDialog } from '../../components/ui/Primitives';
import { useApplyChange } from '../../hooks/useApplyChange';
import type { User } from '../../api/types';

/** Deactivate / reactivate / delete — the irreversible end of the drawer, kept apart from the rest. */
export function UserDangerTab({ user, onDeleted }: { user: User; onDeleted: () => void }) {
  const { apiDeleteUser, apiSetUserState } = useApp();
  const applyChange = useApplyChange();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const toggleActive = () => {
    const next: 'active' | 'inactive' = user.active ? 'inactive' : 'active';
    const verb = next === 'inactive' ? 'deactivate' : 'reactivate';
    applyChange(verb, user.email, () => apiSetUserState(user.id, next));
  };

  const doDelete = () => {
    const ok = applyChange("delete", user.email, () => apiDeleteUser(user.id));
    if (ok) onDeleted();
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>{user.active ? "Deactivate account" : "Reactivate account"}</div>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {user.active
              ? "Blocks login. Identity and data are preserved."
              : "Restores login access for this identity."}
          </div>
          <button className="btn" onClick={user.active ? () => setConfirmDeactivate(true) : toggleActive}>
            {user.active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 4, color: "var(--red, #ef4444)" }}>Delete account</div>
          <div className="small muted" style={{ marginBottom: 10 }}>
            Permanently removes this account. Cannot be undone.
          </div>
          {!confirmDelete
            ? (
              <button
                className="btn"
                style={{ borderColor: "var(--red, #ef4444)", color: "var(--red, #ef4444)" }}
                onClick={() => setConfirmDelete(true)}
              >
                Delete user
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="small" style={{ flex: 1, color: "var(--red, #ef4444)" }}>Delete {user.email}?</span>
                <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button
                  className="btn primary"
                  style={{ background: "var(--red, #ef4444)", borderColor: "var(--red, #ef4444)" }}
                  onClick={doDelete}
                >
                  Delete
                </button>
              </div>
            )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDeactivate}
        title={`Deactivate ${user?.email ?? "user"}?`}
        danger
        confirmLabel="Deactivate"
        body={<>This blocks login for the account. Their identity and data are preserved — you can reactivate them later.</>}
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={() => { setConfirmDeactivate(false); toggleActive(); }}
      />
    </>
  );
}
