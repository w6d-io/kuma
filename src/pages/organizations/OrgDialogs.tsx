import { useState } from 'react';
import { useCreateOrganization, useDeleteOrganization, useServices, useUpdateOrganization } from '../../api/hooks';
import type { OrganizationRecord } from '../../api/client';
import { toastFor } from '../../lib/apiError';
import { stepUpOnRefusal } from '../../lib/resume';
import { orgFormProblem, tenantFrom } from '../../lib/orgTenant';
import { MultiSelectPills } from '../../components/ui/Primitives';
import { Button, Card, ConfirmDialog, Dialog, Field, Input } from '../../components/ui';

type PushToast = (msg: string, opts?: { err?: boolean; sub?: string }) => void;

/**
 * Creating, changing and deleting an organisation. The record is a name and a tenant; which
 * applications it has is a whole set, set here too. Who belongs to it is changed on the people
 * list, never here.
 */

export function CreateOrgDialog({ onClose, onCreated, pushToast }: {
  onClose: () => void;
  onCreated: (org: OrganizationRecord) => void;
  pushToast: PushToast;
}) {
  const create = useCreateOrganization();
  const [name, setName] = useState('');
  const [tenant, setTenant] = useState('');
  const [tried, setTried] = useState(false);
  const problem = orgFormProblem(name, tenant);
  const derived = tenantFrom(name);

  const submit = () => {
    setTried(true);
    if (problem || create.isPending) return;
    create.mutate({ name: name.trim(), ...(tenant.trim() ? { tenant: tenant.trim() } : {}) }, {
      onSuccess: (org) => { pushToast(`Created ${org.name}`, { sub: `Tenant ${org.tenant}` }); onCreated(org); },
      onError: (e) => pushToast(...toastFor(e)),
    });
  };

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

export function EditOrgDialog({ org, name, tenant, applications, onClose, pushToast }: {
  org: string;
  name?: string;
  tenant?: string;
  applications: string[];
  onClose: () => void;
  pushToast: PushToast;
}) {
  const update = useUpdateOrganization();
  const services = useServices();
  const [nextName, setNextName] = useState(name ?? '');
  const [nextTenant, setNextTenant] = useState(tenant ?? '');
  const [apps, setApps] = useState<string[]>(applications);
  const [tried, setTried] = useState(false);
  const problem = orgFormProblem(nextName, nextTenant);
  const options = [...new Set([...(services.data ?? []).map((s) => s.name), ...applications])].sort();

  const toggle = (app: string) => setApps((prev) => (prev.includes(app) ? prev.filter((a) => a !== app) : [...prev, app]));

  const save = () => {
    setTried(true);
    if (problem || update.isPending) return;
    const body: { id: string; name?: string; tenant?: string; applications?: string[] } = { id: org };
    if (nextName.trim() !== (name ?? '')) body.name = nextName.trim();
    if (nextTenant.trim() && nextTenant.trim() !== (tenant ?? '')) body.tenant = nextTenant.trim();
    const sameApps = apps.length === applications.length && apps.every((a) => applications.includes(a));
    if (!sameApps) body.applications = apps;
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
        <Field label="Applications" hint="The sites this organization runs. Saving replaces the whole set.">
          <Card pad="sm">
            <MultiSelectPills options={options} selected={apps} onToggle={toggle} empty="No sites are declared yet." />
          </Card>
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
        : <>The organization record and the applications it has are removed. Nobody belongs to it.</>}
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
