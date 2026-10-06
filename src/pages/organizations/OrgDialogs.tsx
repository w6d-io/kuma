import { useState } from 'react';
import { useCreateOrganization, useDeleteOrganization, useUpdateOrganization } from '../../api/hooks';
import type { OrganizationCreated, OrganizationRecord } from '../../api/client';
import { invitationAddress } from '../../api/invitations';
import { toastFor } from '../../lib/apiError';
import { stepUpOnRefusal } from '../../lib/resume';
import { orgFormProblem, ownerProblem, tenantFrom } from '../../lib/orgTenant';
import { Button, Callout, ConfirmDialog, CopyField, Dialog, Field, I, Input } from '../../components/ui';

type PushToast = (msg: string, opts?: { err?: boolean; sub?: string }) => void;

/**
 * Creating, changing and deleting an organisation. The record is a name and a tenant; it is created
 * for its owner, named by address. Which sites it may use is each site's intent; who belongs to it,
 * and their roles, is changed on the people list.
 */

export function CreateOrgDialog({ onClose, onCreated, pushToast }: {
  onClose: () => void;
  onCreated: (org: OrganizationRecord) => void;
  pushToast: PushToast;
}) {
  const create = useCreateOrganization();
  const [name, setName] = useState('');
  const [tenant, setTenant] = useState('');
  const [owner, setOwner] = useState('');
  const [tried, setTried] = useState(false);
  // An owner with no account yet is invited: the link is answered once, shown here to be sent.
  const [invited, setInvited] = useState<OrganizationCreated | null>(null);
  const problem = orgFormProblem(name, tenant);
  const badOwner = ownerProblem(owner);
  const derived = tenantFrom(name);

  const submit = () => {
    setTried(true);
    if (problem || badOwner || create.isPending) return;
    create.mutate({ name: name.trim(), owner: owner.trim(), ...(tenant.trim() ? { tenant: tenant.trim() } : {}) }, {
      onSuccess: (org) => {
        if (org.owner?.status === 'invited' && org.invitation) {
          pushToast(`Created ${org.name}`, { sub: `${org.owner.email} is invited as owner` });
          setInvited(org);
          return;
        }
        pushToast(`Created ${org.name}`, { sub: `${org.owner?.email ?? owner.trim()} is its owner` });
        onCreated(org);
      },
      onError: (e) => pushToast(...toastFor(e)),
    });
  };

  if (invited?.invitation) {
    const address = invitationAddress(invited.invitation);
    return (
      <Dialog
        open
        onClose={() => onCreated(invited)}
        eyebrow="Organizations"
        title={`${invited.name} created`}
        footer={<Button variant="primary" onClick={() => onCreated(invited)}>Done</Button>}
      >
        <div className="stack gap-12">
          <Callout tone="warning" icon={I.key} title="Send the invitation">
            {invited.owner?.email} has no account yet. Send them this {invited.invitation.link ? 'link' : 'token'}: it is shown once.
            They become owner when they accept it, before {new Date(invited.invitation.expiresAt).toLocaleDateString()}.
          </Callout>
          <Field label={address.label}><CopyField value={address.value} /></Field>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Organizations"
      title="Create organization"
      footer={<>
        <Button onClick={onClose} disabled={create.isPending}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={create.isPending}>Create</Button>
      </>}
    >
      <form className="stack gap-12" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Name" error={tried && problem?.includes('name') ? problem : undefined}>
          <Input id="org-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
        </Field>
        <Field
          label="Owner"
          required
          hint="Their email. An account becomes owner at once; an address with no account is invited."
          error={tried ? badOwner ?? undefined : undefined}
        >
          <Input id="org-owner" type="text" inputMode="email" autoComplete="off" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="jane@acme.com" />
        </Field>
        <Field
          label={<>Tenant <span className="muted">(optional)</span></>}
          hint={derived && !tenant ? <>Derived from the name: <span className="mono">{derived}</span></> : 'The namespace-shaped label its sites deploy under.'}
          error={tried && problem && !problem.includes('name') ? problem : undefined}
        >
          <Input id="org-tenant" mono value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder={derived || 'acme-corp'} />
        </Field>
      </form>
    </Dialog>
  );
}

/** Name and tenant only: which sites an organization may use is each site's intent (`orgs`), not this record. */
export function EditOrgDialog({ org, name, tenant, onClose, pushToast }: {
  org: string;
  name?: string;
  tenant?: string;
  onClose: () => void;
  pushToast: PushToast;
}) {
  const update = useUpdateOrganization();
  const [nextName, setNextName] = useState(name ?? '');
  const [nextTenant, setNextTenant] = useState(tenant ?? '');
  const [tried, setTried] = useState(false);
  const problem = orgFormProblem(nextName, nextTenant);

  const save = () => {
    setTried(true);
    if (problem || update.isPending) return;
    const body: { id: string; name?: string; tenant?: string } = { id: org };
    if (nextName.trim() !== (name ?? '')) body.name = nextName.trim();
    if (nextTenant.trim() && nextTenant.trim() !== (tenant ?? '')) body.tenant = nextTenant.trim();
    if (Object.keys(body).length === 1) { onClose(); return; }
    update.mutate(body, {
      onSuccess: (saved) => { pushToast(`Saved ${saved.name}`); onClose(); },
      onError: (e) => pushToast(...toastFor(e)),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Organizations"
      title="Edit organization"
      size="lg"
      footer={<>
        <Button onClick={onClose} disabled={update.isPending}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={update.isPending}>Save</Button>
      </>}
    >
      <form className="stack gap-12" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Name" error={tried && problem?.includes('name') ? problem : undefined}>
          <Input id="org-edit-name" value={nextName} onChange={(e) => setNextName(e.target.value)} />
        </Field>
        <Field label="Tenant" error={tried && problem && !problem.includes('name') ? problem : undefined}>
          <Input id="org-edit-tenant" mono value={nextTenant} onChange={(e) => setNextTenant(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

export function DeleteOrgDialog({ org, name, members, onClose, onDeleted, pushToast }: {
  org: string;
  name?: string;
  members: number;
  onClose: () => void;
  onDeleted: () => void;
  pushToast: PushToast;
}) {
  const remove = useDeleteOrganization();
  const label = name ?? org;
  return (
    <ConfirmDialog
      open
      danger
      title={`Delete ${label}?`}
      body={members > 0
        ? <>It still has {members} member{members === 1 ? '' : 's'}. Remove them first: their memberships would otherwise point at nothing.</>
        : <>Nobody belongs to it. Its record, domains, roles and pending invitations are removed.</>}
      confirmLabel="Delete organization"
      requireText={members > 0 ? undefined : label}
      busy={remove.isPending}
      onCancel={onClose}
      onConfirm={() => {
        if (members > 0) { onClose(); return; }
        remove.mutate(org, {
          onSuccess: () => { pushToast(`Deleted ${label}`); onDeleted(); },
          onError: (e) => {
            if (stepUpOnRefusal(e, pushToast, { redo: `Delete ${label} again: nothing was deleted before the check.` })) return;
            pushToast(...toastFor(e));
          },
        });
      }}
    />
  );
}
