import { useState } from 'react';
import { CodeView, DiffView, Stepper, Timeline } from '../../components/ui';
import { SectionTitle, Specimen, State } from './Specimen';

const STEPS = [
  { id: 'address', label: 'Address', description: 'host → upstream' },
  { id: 'signin', label: 'Sign-in', description: 'methods, MFA' },
  { id: 'routes', label: 'Routes', description: 'who reaches what' },
  { id: 'review', label: 'Review', description: 'diff and checks' },
];

const RULE = `id: billing-api
match:
  url: https://billing.acme.io/api/<**>
  methods: [GET, POST]
authenticators: [{ handler: cookie_session }]
authorizer: { handler: remote_json }`;

export function FlowSection() {
  const [step, setStep] = useState('routes');
  return (
    <>
      <SectionTitle id="flow" title="Flows & code" sub="Multi-step flows, what happened and how far it got, before/after, code to copy." />
      <Specimen name="Stepper" note="Done steps are buttons back; nothing skips ahead." wide>
        <State label="horizontal"><Stepper steps={STEPS} current={step} onStep={setStep} /></State>
        <div className="grid g2 mt-12">
          <State label="vertical"><Stepper steps={STEPS} current="signin" orientation="vertical" /></State>
          <State label="Timeline · pending / running / done / failed">
            <Timeline items={[
              { id: '1', label: 'Stored in jinbe', state: 'done', meta: '12 ms' },
              { id: '2', label: 'Bundle built', state: 'done', meta: '0.4 s' },
              { id: '3', label: 'Engine polled', state: 'running', meta: '≤ 40 s' },
              { id: '4', label: 'Smoke checks', state: 'pending' },
            ]} />
            <Timeline className="mt-12" items={[
              { id: '1', label: 'Rules compiled', state: 'done' },
              { id: '2', label: 'Rules loaded', state: 'failed', detail: 'oathkeeper: duplicate rule id "billing-api"' },
            ]} />
          </State>
        </div>
      </Specimen>
      <div className="specimen-grid">
        <Specimen name="DiffView" note="Changed / added / removed; unchanged hidden unless asked.">
          <DiffView
            title="Site billing.acme.io"
            before={{ host: 'billing.acme.io', upstream: 'http://billing:8080', methods: ['GET'], mfa: 'writes', legacy: 'yes' }}
            after={{ host: 'billing.acme.io', upstream: 'http://billing-v2:8080', methods: ['GET', 'POST'], mfa: 'writes', orgs: ['acme'] }}
            labels={{ host: 'Address', upstream: 'Upstream', methods: 'Methods', mfa: 'Two-factor', legacy: 'Legacy rule', orgs: 'Organizations' }}
          />
          <DiffView className="mt-12" before={{ a: 1 }} after={{ a: 1 }} />
        </Specimen>
        <Specimen name="CodeView" note="Monospace, scrolls inside, copy says whether it worked.">
          <CodeView title="billing-api.yaml" language="yaml" code={RULE} maxHeight="md" />
          <CodeView className="mt-12" title="login snippet" language="html" wrap code={'<a href="https://auth.acme.io/login?return_to=https://billing.acme.io">Sign in</a>'} />
        </Specimen>
      </div>
    </>
  );
}
