import { useState } from 'react';
import { Button, ConfirmDialog, Dialog, Drawer, Field, I, Input, Tabs, Toasts } from '../../components/ui';
import { SectionTitle, Specimen, State } from './Specimen';

export function OverlaysSection() {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState<'plain' | 'typed' | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState('site');
  return (
    <>
      <SectionTitle id="overlays" title="Overlays" sub="Radix Dialog underneath: focus trapped and returned, Escape and the scrim close, only the top one closes when stacked." />
      <div className="specimen-grid">
        <Specimen name="Dialog">
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            eyebrow="Settings"
            title="Export configuration"
            footer={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" icon={I.download} onClick={() => setDialog(false)}>Export</Button></>}
          >
            <Field label="File name" hint="Downloaded as JSON."><Input mono defaultValue="kuma-bundle.json" /></Field>
          </Dialog>
        </Specimen>
        <Specimen name="ConfirmDialog" note="Every destructive action; blast radius; type-to-confirm for what cannot be undone.">
          <div className="row gap-8 wrap">
            <Button onClick={() => setConfirm('plain')}>Revoke session</Button>
            <Button variant="danger" onClick={() => setConfirm('typed')}>Delete organization</Button>
          </div>
          <ConfirmDialog
            open={confirm === 'plain'}
            title="Revoke this session?"
            body="The browser is signed out at its next request."
            confirmLabel="Revoke"
            danger
            onConfirm={() => setConfirm(null)}
            onCancel={() => setConfirm(null)}
          />
          <ConfirmDialog
            open={confirm === 'typed'}
            title="Delete Acme?"
            body="Members lose every grant Acme gave them."
            blastRadius="Affects 42 people and 3 sites."
            requireText="acme"
            confirmLabel="Delete organization"
            danger
            onConfirm={() => setConfirm(null)}
            onCancel={() => setConfirm(null)}
          />
        </Specimen>
        <Specimen name="Drawer" note="Work on one thing beside the list; full width on a phone.">
          <Button onClick={() => setDrawer(true)}>Open drawer</Button>
          <Drawer
            open={drawer}
            onClose={() => setDrawer(false)}
            eyebrow="People"
            title="Ada Lovelace"
            footer={<><Button variant="ghost" onClick={() => setDrawer(false)}>Close</Button><Button variant="primary">Save</Button></>}
          >
            <Tabs label="Access" full value={tab} onChange={setTab} items={[{ value: 'site', label: 'Site access' }, { value: 'org', label: 'Org access' }]} />
            <p className="small muted">Drawer body — {tab === 'site' ? 'grants on every site' : 'grants inside one organization'}.</p>
          </Drawer>
        </Specimen>
        <Specimen name="Toast" note="Live region; failures say so in words.">
          <State label="static preview (normally fixed bottom-left)">
            <div className="toast-preview">
              <Toasts toasts={[{ id: '1', msg: 'Group saved', sub: 'live on the next request' }, { id: '2', msg: 'Could not revoke key', err: true, sub: '503 · engine unreachable' }]} />
            </div>
          </State>
        </Specimen>
      </div>
    </>
  );
}
