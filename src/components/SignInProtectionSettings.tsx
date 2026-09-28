import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useSetSignInProtection, useSignInProtection } from '../api/hooks';
import type { BotCheckFlow, RegistrationMode } from '../api/client';
import { I, Badge, Button, Callout, Card, Field, Segmented, Switch, Textarea } from './ui';
import { toastFor } from '../lib/apiError';
import { bounceToStepUp } from '../lib/stepUp';
import {
  BOT_CHECK_FLOWS,
  PROVIDER_LABEL,
  draftProblems,
  fromDraft,
  protectionWarnings,
  sameProtection,
  toDraft,
  type ProtectionDraft,
} from '../lib/signInProtection';

const MODES: { value: RegistrationMode; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'allowlist', label: 'Allow-list' },
  { value: 'closed', label: 'Closed' },
];

const MODE_TEXT: Record<RegistrationMode, string> = {
  open: 'Anyone can create an account from the sign-in page.',
  allowlist: 'Only the addresses and domains below can create an account. Others are told sign-ups are limited.',
  closed: 'Nobody can create an account from the sign-in page; administrators create them from Users. The link to sign up is hidden.',
};

/**
 * Settings · Sign-in protection: a bot check on each public sign-in flow, and who may sign up. Both
 * are enforced by jinbe from an interrupting Kratos hook — a script calling the identity service
 * directly meets them too — and a change applies within seconds. Hidden when jinbe predates it.
 */
export function SignInProtectionSettings() {
  const { pushToast } = useApp();
  const { data, isError } = useSignInProtection();
  const save = useSetSignInProtection();
  const [draft, setDraft] = useState<ProtectionDraft | null>(null);

  useEffect(() => { if (data) setDraft(toDraft(data.settings)); }, [data]);

  const candidate = useMemo(() => (draft ? fromDraft(draft) : null), [draft]);
  if (isError || !data || !draft || !candidate) return null;

  const { provider } = data;
  const problems = draftProblems(draft);
  const dirty = !sameProtection(candidate, data.settings);
  const warnings = protectionWarnings(candidate, provider);
  const patch = (p: Partial<ProtectionDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setFlow = (f: BotCheckFlow, on: boolean) => setDraft((d) => (d ? { ...d, flows: { ...d.flows, [f]: on } } : d));

  function submit() {
    if (!candidate) return;
    save.mutate(candidate, {
      onSuccess: () => pushToast('Sign-in protection saved', { sub: 'The sign-in pages and the identity service use it within a few seconds.' }),
      onError: (e: Error & { code?: string }) => {
        if (e.code === 'reauth_required') {
          pushToast('Two-factor re-verification required', { err: true, sub: 'You will be sent to re-verify your second factor, then back here to save again. This is not a sign-out.' });
          bounceToStepUp();
          return;
        }
        pushToast(...toastFor(e));
      },
    });
  }

  return (
    <Card
      title="Sign-in protection"
      sub="Stop scripted sign-ups and sign-ins, and choose who may create an account. Enforced by the identity service itself, so calling it directly does not get around it."
    >
      {/* ─── Provider ─── */}
      <div className="settings-row master">
        <div className="flex-1 min-w-0">
          <div className="fw-medium text-base">
            Bot check · {PROVIDER_LABEL[provider.provider] ?? provider.provider}
            {provider.configured
              ? <Badge tone={provider.testKeys ? 'warning' : 'success'} mono={false}>{provider.testKeys ? 'test keys' : 'configured'}</Badge>
              : <Badge tone="neutral" mono={false}>not configured</Badge>}
          </div>
          <div className="small muted">
            {provider.configured
              ? <>Site key <span className="mono">{provider.siteKey}</span>. The secret is kept by the service and never shown.</>
              : <>Not configured: {provider.problem}. The site key and secret are set by the platform operator (environment and vault), not here.</>}
          </div>
        </div>
      </div>

      {BOT_CHECK_FLOWS.map((f) => {
        const on = draft.flows[f.id];
        // A check that cannot be made cannot be turned on (it would refuse everyone); one already on can be turned off.
        const locked = !provider.configured && !on;
        return (
          <div key={f.id} className="settings-row">
            <div className="flex-1 min-w-0">
              <div className="fw-medium text-base">{f.label}</div>
              <div className="small muted">{f.hint}</div>
            </div>
            {locked
              ? <span className="small muted">needs a provider</span>
              : <Switch on={on} onChange={(v) => setFlow(f.id, v)} label={`Bot check on ${f.label.toLowerCase()}`} disabled={save.isPending} />}
          </div>
        );
      })}

      <div className="settings-row">
        <div className="flex-1 min-w-0">
          <div className="fw-medium text-base">If the provider cannot be reached</div>
          <div className="small muted">
            {draft.failMode === 'closed'
              ? 'Refuse the attempt and ask to try again in a minute. Safer; an outage of the provider blocks the flows that ask for the check.'
              : 'Let the attempt through unchecked while the provider is down. A missing or wrong answer is still refused.'}
          </div>
        </div>
        <Segmented
          label="If the provider cannot be reached"
          value={draft.failMode}
          onChange={(v) => patch({ failMode: v })}
          options={[{ value: 'closed', label: 'Refuse' }, { value: 'open', label: 'Let through' }]}
        />
      </div>

      {warnings.includes('login-fail-closed') && (
        <Callout tone="warning" icon={I.alert} title="A provider outage would block every sign-in" className="mt-12">
          <div className="small">With the sign-in check on and “Refuse” chosen, nobody can sign in while the provider is down — including the administrators who could turn the check off. The way back is then an operator removing the setting from the settings store; or choose “Let through”.</div>
        </Callout>
      )}
      {warnings.includes('fail-open') && (
        <Callout tone="info" icon={I.info} title="An outage of the provider opens the checked flows" className="mt-12">
          <div className="small">Attempts made while the provider is down go through unchecked. They are counted, so a flood during an outage shows up.</div>
        </Callout>
      )}
      {warnings.includes('test-keys') && (
        <Callout tone="danger" icon={I.alert} title="Test keys pass every visitor" className="mt-12">
          <div className="small">The provider is configured with its published test keys: the widget shows, but nothing is checked. Use real keys outside a sandbox.</div>
        </Callout>
      )}
      {warnings.includes('provider-lost') && (
        <Callout tone="danger" icon={I.alert} title="A bot check is on but no provider is configured" className="mt-12">
          <div className="small">{draft.failMode === 'closed' ? 'Those flows refuse every attempt until the provider is configured again. Turn them off, or ask the operator to restore the keys.' : 'Those flows go through unchecked until the provider is configured again.'}</div>
        </Callout>
      )}

      {/* ─── Who may sign up ─── */}
      <div className="settings-row master mt-12">
        <div className="flex-1 min-w-0">
          <div className="fw-medium text-base">
            Who may sign up
            {draft.mode === 'closed' && <Badge tone="warning" mono={false}>admin-created accounts only</Badge>}
          </div>
          <div className="small muted">{MODE_TEXT[draft.mode]}</div>
        </div>
        <Segmented label="Who may sign up" value={draft.mode} onChange={(v) => patch({ mode: v })} options={MODES} />
      </div>

      {draft.mode === 'allowlist' && (
        <Field
          label="Allowed addresses and domains"
          hint="One per line. A domain (corp.io) allows every address at it; *.corp.io allows its subdomains. Domains are named on the sign-up page; single addresses never are."
          error={problems.allow}
          required
        >
          <Textarea mono rows={5} value={draft.allowText} onChange={(e) => patch({ allowText: e.target.value })} placeholder={'corp.io\n*.lab.corp.io\ncontractor@gmail.com'} />
        </Field>
      )}

      {draft.mode !== 'closed' && (
        <>
          <div className="settings-row">
            <div className="flex-1 min-w-0">
              <div className="fw-medium text-base">Refuse disposable inboxes</div>
              <div className="small muted">Throwaway addresses from {data.disposableDomains} well-known providers (mailinator.com, yopmail.com…). An address or domain on the allow-list is still accepted.</div>
            </div>
            <Switch on={draft.blockDisposable} onChange={(v) => patch({ blockDisposable: v })} label="Refuse disposable inboxes" disabled={save.isPending} />
          </div>
          <Field
            label="Other domains to refuse"
            hint="One per line. Applies whatever the switch above says; a domain covers its subdomains."
            error={problems.deny}
          >
            <Textarea mono rows={3} value={draft.denyText} onChange={(e) => patch({ denyText: e.target.value })} placeholder="spam-provider.example" />
          </Field>
        </>
      )}

      <div className="row wrap gap-8 mt-12">
        <Button variant="primary" onClick={submit} disabled={!dirty || !!problems.allow || !!problems.deny || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(toDraft(data.settings))} disabled={!dirty || save.isPending}>
          Discard changes
        </Button>
        <span className="small muted">Saving needs a super admin who confirmed a second factor in the last 15 minutes. Every change is audited.</span>
      </div>
    </Card>
  );
}
