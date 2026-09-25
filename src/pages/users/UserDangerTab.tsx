import { useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { Button, Card, ConfirmDialog } from '../../components/ui';
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
      <div className="stack gap-12">
        <Card pad="md">
          <div className="fw-medium mb-4">{user.active ? "Deactivate account" : "Reactivate account"}</div>
          <div className="small muted mb-12">
            {user.active
              ? "Blocks login. Identity and data are preserved."
              : "Restores login access for this identity."}
          </div>
          <Button onClick={user.active ? () => setConfirmDeactivate(true) : toggleActive}>
            {user.active ? "Deactivate" : "Reactivate"}
          </Button>
        </Card>
        <Card pad="md">
          <div className="fw-medium mb-4 text-danger">Delete account</div>
          <div className="small muted mb-12">
            Permanently removes this account. Cannot be undone.
          </div>
          {!confirmDelete
            ? (
              <Button className="people-danger-outline" onClick={() => setConfirmDelete(true)}>
                Delete user
              </Button>
            ) : (
              <div className="row gap-8">
                <span className="small flex-1 text-danger">Delete {user.email}?</span>
                <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button variant="danger" onClick={doDelete}>
                  Delete
                </Button>
              </div>
            )}
        </Card>
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
