import { useState } from 'react';
import { OrgPicker } from '../../components/OrgPicker';
import { Field } from '../../components/ui';
import { CreateOrgKeyDrawer } from './CreateOrgKeyDrawer';
import { CreatePersonalKeyDrawer } from './CreatePersonalKeyDrawer';

/**
 * Create key on the API keys page, the one place keys are made. "For": me (a personal key, acting as
 * the person) or any organization (a machine key, platform staff with orgs.keys:write). Starts on what
 * the page shows (`initialOwner`: '' = my keys). Somebody who may not make organization keys gets the
 * personal form only; with personal keys off, the organization form only.
 */
export function CreateKeyDrawer({ initialOwner, mayCreateOrgKeys, personalAvailable, onClose, onCreated }: {
  initialOwner: string;
  mayCreateOrgKeys: boolean;
  personalAvailable: boolean;
  onClose: () => void;
  /** '' for a personal key, else the organization's id. */
  onCreated: (owner: string) => void;
}) {
  const [owner, setOwner] = useState(mayCreateOrgKeys ? initialOwner : '');
  const personal = owner === '' && personalAvailable;
  const ownerField = mayCreateOrgKeys && (
    <Field label="For" required hint={personal ? 'A personal key acts as you, with your permissions.' : 'The key belongs to the organization and works on every site serving it.'}>
      <OrgPicker value={owner} onChange={setOwner} ariaLabel="Key for" noneLabel={personalAvailable ? 'Me — a personal key' : undefined} />
    </Field>
  );
  return personal
    ? <CreatePersonalKeyDrawer ownerField={ownerField} onClose={onClose} onCreated={() => onCreated('')} />
    : <CreateOrgKeyDrawer key={owner} org={owner} ownerField={ownerField} onClose={onClose} onCreated={onCreated} />;
}
