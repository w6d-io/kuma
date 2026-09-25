import { useState } from 'react';
import { Button, Checkbox, Field, I, Input, RadioGroup, Segmented, Select, Switch, Tabs, Textarea } from '../../components/ui';
import { MultiSelectPills } from '../../components/ui/Primitives';
import { SectionTitle, Specimen, State } from './Specimen';

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;

export function ControlsSection() {
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [tab, setTab] = useState('access');
  const [win, setWin] = useState('24h');
  const [pills, setPills] = useState(['billing']);
  const [expiry, setExpiry] = useState('flag');
  return (
    <>
      <SectionTitle id="controls" title="Controls" sub="Everything you click or type in. Two heights: sm 28px for toolbars and rows, md 36px for headers, forms and footers." />
      <Specimen name="Button" note="primary (one per view) · secondary (default) · ghost (inside content) · danger (removes or revokes)." wide>
        <div className="state-table">
          <div className="state-row head"><span /><span>md</span><span>sm</span><span>icon</span><span>icon-only</span><span>loading</span><span>disabled</span></div>
          {VARIANTS.map((v) => (
            <div key={v} className="state-row">
              <span className="mono text-xs">{v}</span>
              <span><Button variant={v}>Save changes</Button></span>
              <span><Button variant={v} size="sm">Save</Button></span>
              <span><Button variant={v} size="sm" icon={I.plus}>Add</Button></span>
              <span><Button variant={v} size="sm" iconOnly icon={I.trash} aria-label="Delete" /></span>
              <span><Button variant={v} size="sm" loading>Saving…</Button></span>
              <span><Button variant={v} size="sm" disabled>Save</Button></span>
            </div>
          ))}
        </div>
        <div className="row mt-12 gap-8"><Button variant="primary" kbd="⌘↵">Apply</Button><Button trailing={I.arrowOut}>Open in Grafana</Button></div>
      </Specimen>

      <div className="specimen-grid">
        <Specimen name="Input">
          <State label="md · placeholder"><Input placeholder="name@example.com" /></State>
          <State label="sm · leading icon"><Input size="sm" leading={I.search} placeholder="Search name or email…" /></State>
          <State label="mono"><Input mono defaultValue="acme-billing" /></State>
          <State label="invalid"><Input invalid defaultValue="not an email" /></State>
          <State label="disabled"><Input disabled defaultValue="read only" /></State>
        </Specimen>
        <Specimen name="Select · Textarea">
          <State label="Select md"><Select defaultValue="b"><option value="a">All groups</option><option value="b">platform-admins</option></Select></State>
          <State label="Select sm"><Select size="sm" defaultValue="a"><option value="a">25 / page</option></Select></State>
          <State label="Textarea"><Textarea placeholder="Why is this access needed?" /></State>
          <State label="Textarea mono invalid"><Textarea mono invalid defaultValue={'{ "bad": json'} /></State>
        </Specimen>
        <Specimen name="Field" note="Label, hint, warning (accepted, needs a look), error (refused), required.">
          <Field label="Email" hint="The sign-in address." required><Input placeholder="name@example.com" /></Field>
          <Field label="Host" warning="Already used by another site — both will share the cookie."><Input mono defaultValue="app.example.com" /></Field>
          <Field label="Upstream" error="Must be an http(s) URL inside the cluster."><Input mono defaultValue="ftp://x" /></Field>
          <Field label="Self-registration" inline hint="Anyone can create an account on the login page."><Switch on={on} onChange={setOn} label="Self-registration" /></Field>
        </Specimen>
        <Specimen name="Checkbox · RadioGroup · Switch">
          <State label="Checkbox"><Checkbox checked={checked} onChange={setChecked} label="Send an invite email" hint="They set a password from the link." /></State>
          <State label="Checkbox disabled"><Checkbox checked={false} onChange={() => {}} disabled label="Require MFA (needs TOTP enabled)" /></State>
          <State label="Checkbox indeterminate"><Checkbox checked={false} indeterminate onChange={() => {}} label="Select all (2 of 6)" /></State>
          <State label="RadioGroup"><RadioGroup label="On expiry" name="ds-expiry" value={expiry} onChange={setExpiry} options={[{ value: 'flag', label: 'Flag', hint: 'membership untouched' }, { value: 'revoke', label: 'Revoke', hint: 'remove the membership' }]} /></State>
          <State label="Switch on / off / disabled">
            <div className="row gap-12"><Switch on={on} onChange={setOn} label="Demo" /><Switch on={!on} onChange={(v) => setOn(!v)} label="Demo inverse" /><Switch on disabled onChange={() => {}} label="Locked" /></div>
          </State>
        </Specimen>
        <Specimen name="Tabs" note="Switch views. Arrow keys move, Home/End jump.">
          <Tabs label="User" value={tab} onChange={setTab} items={[{ value: 'access', label: 'Access', icon: I.shield }, { value: 'orgs', label: 'Organizations', count: 3 }, { value: 'sessions', label: 'Sessions' }, { value: 'danger', label: 'Danger', disabled: true }]} />
          <Tabs label="Drawer" full value={tab} onChange={setTab} items={[{ value: 'access', label: 'Site access' }, { value: 'orgs', label: 'Org access' }]} />
        </Specimen>
        <Specimen name="Segmented · MultiSelectPills" note="A setting with a few values; a set of toggles.">
          <State label="Segmented sm"><Segmented label="Window" value={win} onChange={setWin} options={[{ value: '1h', label: '1h' }, { value: '24h', label: '24h' }, { value: '7d', label: '7 days', count: 12 }]} /></State>
          <State label="Segmented md"><Segmented size="md" label="Window" value={win} onChange={setWin} options={[{ value: '1h', label: '1h' }, { value: '24h', label: '24h' }]} /></State>
          <State label="Pills"><MultiSelectPills options={['billing', 'crm', 'wiki']} selected={pills} onToggle={(o) => setPills((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]))} /></State>
        </Specimen>
      </div>
    </>
  );
}
