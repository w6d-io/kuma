import { useState } from 'react';
import {
  ActionBar, Button, Card, Checkbox, Field, FieldRow, FormGrid, I, Input, Segmented, Select, Switch, Table, Th, Toolbar, ToolbarSpacer,
} from '../../components/ui';
import { SectionTitle, Specimen, State } from './Specimen';

/** The layout primitives: how fields, toggles, toolbars, actions and table columns line up. */
export function LayoutSection() {
  const [invite, setInvite] = useState(true);
  const [mfa, setMfa] = useState(false);
  const [on, setOn] = useState(true);
  const [win, setWin] = useState('all');
  return (
    <>
      <SectionTitle id="layout" title="Layout" sub="Things side by side share a line. Fields in a row share the label, control and message lines; a toolbar shares one centre; a checkbox sits on its label's first line." />
      <Specimen name="FieldRow" note="Widths are shares (span). A hint or an error under one field moves nothing in the others. Below 640px the fields stack." wide>
        <FieldRow>
          <Field label="Service" span={2}><Input mono defaultValue="payroll-ui" /></Field>
          <Field label="Namespace" span={2} error="Must be a DNS label."><Input mono defaultValue="Payroll" /></Field>
          <Field label="Port"><Input mono inputMode="numeric" defaultValue="8080" /></Field>
        </FieldRow>
        <FieldRow>
          <Field label="Secret" hint="Shown once."><Input mono readOnly defaultValue="s3cr3t-••••" /></Field>
          <Button icon={I.copy}>Copy</Button>
        </FieldRow>
      </Specimen>
      <div className="specimen-grid">
        <Specimen name="FormGrid" note="Fields stacked at one rhythm (--field-gap 16px).">
          <FormGrid>
            <Field label="Email" required><Input placeholder="name@example.com" /></Field>
            <Field label="Full name"><Input placeholder="Jane Doe" /></Field>
            <Field label="Send invite email" inline hint="Emails them a link to set their password."><Switch on={invite} onChange={setInvite} label="Send invite email" /></Field>
          </FormGrid>
        </Specimen>
        <Specimen name="FormGrid labels=aside" note="One label column as wide as the widest label; every control, checkbox and message in the column beside it.">
          <FormGrid labels="aside">
            <Field label="Name"><Input defaultValue="Payroll" /></Field>
            <Field label="Upstream port" hint="Inside the cluster."><Input mono defaultValue="8080" /></Field>
            <Field label="Scheme"><Select defaultValue="http"><option>http</option><option>https</option></Select></Field>
            <Checkbox checked={mfa} onChange={setMfa} label="Require a second factor" hint="On every write." />
          </FormGrid>
        </Specimen>
        <Specimen name="Checkbox · Switch alignment" note="Box centred on the first line; hint under the label text. Switch level with the setting's name.">
          <State label="one line · two lines · sm"><div className="stack gap-8">
            <Checkbox checked onChange={() => {}} label="Send an invite email" />
            <Checkbox checked={false} onChange={() => {}} label="Allow passwordless sign-in" hint="A one-time code by email, as the first factor." />
            <Checkbox checked onChange={() => {}} size="sm" label="Sub-option in smaller type" />
          </div></State>
          <State label="switch row"><Field label="Self-registration" inline hint="Anyone can create an account on the login page."><Switch on={on} onChange={setOn} label="Self-registration" /></Field></State>
        </Specimen>
        <Specimen name="Toolbar · ActionBar" note="One height per toolbar (sm 28px) so every piece shares a centre; actions end right, primary last.">
          <Card pad="none">
            <Toolbar inset label="Filter">
              <Input size="sm" leading={I.search} placeholder="Search…" aria-label="Search" />
              <Select size="sm" aria-label="Group"><option>All groups</option></Select>
              <Segmented label="State" value={win} onChange={setWin} options={[{ value: 'all', label: 'All' }, { value: 'on', label: 'On' }]} />
              <ToolbarSpacer />
              <span className="toolbar-note">12 / 40</span>
            </Toolbar>
            <div className="p-12"><ActionBar start={<Button variant="danger" size="sm" icon={I.trash}>Delete</Button>}><Button size="sm">Cancel</Button><Button size="sm" variant="primary">Save</Button></ActionBar></div>
            <div className="p-12"><ActionBar divider start={<span className="small muted">divider: ruled off from the form above</span>}><Button size="sm">Cancel</Button><Button size="sm" variant="primary">Preview</Button></ActionBar></div>
          </Card>
        </Specimen>
      </div>
      <Specimen name="Table columns" note="kind=num: right-aligned tabular figures, header included · kind=actions: as narrow as its buttons, far right." wide>
        <Card pad="none">
          <Table>
            <thead><tr><Th>Group</Th><Th kind="num">Members</Th><Th kind="num">Routes</Th><Th kind="actions" aria-label="Actions" /></tr></thead>
            <tbody>
              {[['platform-admins', 3, 1204], ['payroll_editors', 18, 42], ['users', 1402, 7]].map(([g, m, r]) => (
                <tr key={g}><td className="mono">{g}</td><td className="num">{m}</td><td className="num">{r}</td><td className="actions"><Button size="sm" variant="ghost" icon={I.edit}>Edit</Button></td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </Specimen>
    </>
  );
}
