import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BULK_MAX_ITEMS, type BulkJob } from '../../api/bulk';
import { useSiteGroups } from '../access/access';
import { Button, Callout, Card, Checkbox, Field, Textarea, Toolbar, ToolbarSpacer } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { parseInvites } from '../../lib/bulk';
import { useBulkPermissions } from '../../hooks/useBulkPermissions';
import { BulkDialog } from './BulkDialog';
import { SiteGroupRows } from './SiteGroupRows';

/** People picked on the directory, by identity id, with the address shown for each. */
export type Selection = Map<string, string>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What to do with the people ticked on the directory: resend their verification link, or add them to
 * groups. Both preview first, then run what the preview showed.
 */
export function SelectionBar({ selected, onClear }: { selected: Selection; onClear: () => void }) {
  const may = useBulkPermissions();
  const qc = useQueryClient();
  const [open, setOpen] = useState<'verify' | 'groups' | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const siteRows = useSiteGroups();
  const ids = [...selected.keys()];
  const labels = ids.map(id => selected.get(id) ?? id);
  const tooMany = ids.length > BULK_MAX_ITEMS;
  const finished = (job: BulkJob) => {
    if (job.counts.done > 0) qc.invalidateQueries({ queryKey: ['users'] });
  };

  return (
    <>
      <Toolbar inset label="Selected users">
        <span className="toolbar-note">{plural(ids.length, 'person', 'people')} selected</span>
        {may.verify && <Button size="sm" icon={I.sync} disabled={tooMany} onClick={() => setOpen('verify')}>Resend verification</Button>}
        {may.addToGroups && <Button size="sm" icon={I.group} disabled={tooMany} onClick={() => { setGroups([]); setOpen('groups'); }}>Add to groups</Button>}
        <ToolbarSpacer />
        {tooMany && <span className="toolbar-note">At most {BULK_MAX_ITEMS} at a time</span>}
        <Button size="sm" variant="ghost" onClick={onClear}>Clear selection</Button>
      </Toolbar>
      <BulkDialog
        open={open === 'verify'}
        onClose={() => setOpen(null)}
        title={`Resend the verification email to ${plural(ids.length, 'person', 'people')}?`}
        op="users.verification"
        build={() => ({ items: ids.map(user => ({ user })), labels })}
        runLabel={n => `Send ${plural(n, 'link')}`}
        redo="Resend the verification emails again (Users: select the people, Resend verification); nothing was sent."
        onFinished={finished}
      />
      <BulkDialog
        open={open === 'groups'}
        onClose={() => setOpen(null)}
        title={`Add ${plural(ids.length, 'person', 'people')} to groups`}
        op="groups.members.add"
        ready={groups.length > 0}
        compose={
          <div className="stack gap-12">
            <div className="confirm-body">
              Adds each of them to the groups you tick. Nothing they already hold is taken away, and your own account is never changed from here.
            </div>
            <div>
              <div className="input-label">Groups</div>
              <Card><SiteGroupRows {...siteRows} mayAssign checked={groups} toggle={g => setGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])} /></Card>
            </div>
            <div className="small muted">Needs your own second factor proven in the last 15 minutes.</div>
          </div>
        }
        build={() => ({ items: ids.map(user => ({ user, groups })), labels })}
        runLabel={n => `Add ${plural(n, 'person', 'people')}`}
        redo="Add the people to the groups again (Users: select them, Add to groups); nothing was added."
        onFinished={finished}
      />
    </>
  );
}

/**
 * "Invite people": a pasted list of addresses becomes accounts, previewed first. Groups and individual
 * access come after (jinbe's bulk invite takes neither yet): Add to groups, or each person's Access tab.
 */
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const may = useBulkPermissions();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const parsed = parseInvites(text);
  const mail = sendInvite && may.inviteMail;

  return (
    <BulkDialog
      open={open}
      onClose={() => { setText(''); onClose(); }}
      title="Invite people"
      op="users.invite"
      ready={parsed.invites.length > 0}
      compose={
        <div className="stack gap-12">
          <Field
            label="Addresses"
            required
            hint={`One per line, or separated by commas. “Jane Doe <jane@example.com>” sets the name too. At most ${BULK_MAX_ITEMS}.`}
            warning={parsed.invalid.length ? `Not addresses, left out: ${parsed.invalid.slice(0, 5).join(', ')}${parsed.invalid.length > 5 ? ` and ${parsed.invalid.length - 5} more` : ''}` : undefined}
          >
            <Textarea id="invite-addresses" mono rows={8} placeholder={'jane@example.com\nJohn Roe <john@example.com>'} value={text} onChange={e => setText(e.target.value)} />
          </Field>
          {parsed.tooMany && (
            <Callout tone="warning" icon={I.alert}>Only the first {BULK_MAX_ITEMS} addresses are taken. Invite the rest in another round.</Callout>
          )}
          {may.inviteMail
            ? <Checkbox checked={sendInvite} onChange={setSendInvite} label="Send invite emails" hint="Emails each a link to set their password." />
            : <div className="small muted">They are not emailed: sending invites needs users:recovery. Send each a recovery email from their Edit tab.</div>}
          <div className="small muted">
            {parsed.invites.length ? `${plural(parsed.invites.length, 'address', 'addresses')} to check.` : 'Nothing to check yet.'} New accounts
            have no groups and no individual access — add them with Add to groups, or from each person&apos;s Access tab, once they exist.
          </div>
        </div>
      }
      build={() => ({
        items: parsed.invites,
        params: { sendInvite: mail },
        labels: parsed.invites.map(i => (i.name ? `${i.name} <${i.email}>` : i.email)),
      })}
      runLabel={n => `Create ${plural(n, 'account')}`}
      redo="Invite the people again (Users: Invite people); nothing was created."
      onFinished={job => { if (job.counts.done > 0) { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['stats'] }); } }}
    />
  );
}
