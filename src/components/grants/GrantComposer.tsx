import { useState } from 'react';
import { Card, Field, Switch } from '../ui';
import type { GrantDraft } from '../../lib/grants';
import { GrantPicker } from './GrantPicker';

/**
 * "Individual roles / permissions" in an add or invite flow, beside Groups: off by default, the
 * picker once switched on. Switching it off drops what was picked, so nothing hidden is sent.
 */
export function GrantComposer({ org, onChange, hint }: {
  org?: string;
  onChange: (drafts: GrantDraft[], valid: boolean) => void;
  hint?: string;
}) {
  const [on, setOn] = useState(false);
  return (
    <div className="stack gap-8">
      <Field
        label={<>Individual roles / permissions <span className="muted">(optional)</span></>}
        inline
        hint={hint ?? (org ? 'Single roles or permissions in this organization, beside its roles.' : 'Single roles or permissions for this person, beside their groups.')}
      >
        <Switch on={on} onChange={(v) => { setOn(v); if (!v) onChange([], true); }} label="Individual roles / permissions" />
      </Field>
      {on && <Card pad="md"><GrantPicker org={org} onChange={onChange} /></Card>}
    </div>
  );
}
