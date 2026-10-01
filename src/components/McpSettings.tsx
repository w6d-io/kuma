import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useGroups, useMcpSettings, useSetMcpSettings } from '../api/hooks';
import type { McpSettings as McpSettingsDoc } from '../api/client';
import { I, Badge, Button, Callout, Card, ChecklistGroups, Field, Input, Segmented, Select, Switch } from './ui';
import { toastFor } from '../lib/apiError';
import { stepUpAndResume, useResume } from '../lib/resume';
import { MCP_MAX_DAYS, PROTECTED_HOUR_CHOICES, fromMcpDraft, mcpDraftProblems, sameMcp, toMcpDraft, type McpDraft } from '../lib/mcpSettings';

const DAY_CHOICES = [1, 3, 7, 14, 30].filter((d) => d <= MCP_MAX_DAYS);

/**
 * Settings · AI assistants (MCP): whether people may connect an AI assistant or another MCP client
 * that acts as them — personal keys, delegated tokens and the MCP server's calls into the platform.
 * Under the deployment's own switch (DELEGATED_TOKENS_ENABLED): when that is off, nothing here turns
 * it on, and the card says so. Turning it off applies within seconds; keys stay, unusable, until it
 * is turned back on. Hidden when jinbe predates it.
 */
export function McpSettings() {
  const { pushToast } = useApp();
  const { data, isError } = useMcpSettings();
  const save = useSetMcpSettings();
  const groups = useGroups().data;
  const [draft, setDraft] = useState<McpDraft | null>(null);

  useEffect(() => { if (data) setDraft(toMcpDraft(data.settings)); }, [data]);

  // Back from the step-up the save needed: saved again, once, if nobody changed them meanwhile.
  useResume<{ next: McpSettingsDoc; was: McpSettingsDoc }>('mcp-settings', !!data, ({ next, was }) => {
    setDraft(toMcpDraft(next));
    if (data && sameMcp(data.settings, was)) submit(next);
    else pushToast('AI assistant settings changed meanwhile', { sub: 'Nothing was saved. Your choice is back in the form — check it and save.', ttl: 8000 });
  });

  const candidate = useMemo(() => (draft ? fromMcpDraft(draft) : null), [draft]);
  const groupOptions = useMemo(() => {
    // A stored group the list does not hold (deleted, or not readable) stays visible, so it can be unticked.
    const names = [...new Set([...(groups ?? []).map((g) => g.name), ...(draft?.groups ?? [])])].sort();
    return names.map((name) => ({ value: name, label: <span className="mono">{name}</span>, search: name }));
  }, [groups, draft?.groups]);

  if (isError || !data || !draft || !candidate) return null;

  const problems = mcpDraftProblems(draft);
  const dirty = !sameMcp(candidate, data.settings);
  const ceiling = data.ceiling.enabled;
  const patch = (p: Partial<McpDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  function submit(next = candidate) {
    if (!next || !data) return;
    const was = data.settings;
    save.mutate(next, {
      onSuccess: (view) => pushToast('AI assistant settings saved', {
        sub: !view.ceiling.enabled
          ? 'Saved, but this deployment keeps MCP off until its operator turns it on.'
          : view.effective ? 'People can connect AI assistants within a few seconds.' : 'Personal keys and assistant connections are refused within a few seconds. Keys are kept.',
      }),
      onError: (e: Error & { code?: string }) => {
        if (e.code === 'reauth_required') {
          const going = stepUpAndResume('mcp-settings', { next, was });
          pushToast('Two-factor re-verification required', { err: true, sub: going
            ? 'Nothing was saved yet. You will be sent to re-verify your second factor; back here it is saved by itself. This is not a sign-out.'
            : 'Nothing was saved. Re-verify your second factor, then save again.' });
          return;
        }
        pushToast(...toastFor(e));
      },
    });
  }

  return (
    <Card
      title="AI assistants (MCP)"
      sub="Let people connect an AI assistant or another MCP client that acts as them — never with more than they hold. Applies to personal keys and to the MCP server's calls."
    >
      {!ceiling && (
        <Callout tone="info" icon={I.info} title="Switched off by this deployment" className="mb-12">
          <div className="small">The platform operator has not enabled delegated access (<span className="mono">DELEGATED_TOKENS_ENABLED</span>). Nothing saved here turns MCP on; it applies once the deployment allows it.</div>
        </Callout>
      )}

      <div className="settings-row master">
        <div className="flex-1 min-w-0">
          <div className="fw-medium text-base">
            Allow AI assistants
            {!ceiling
              ? <Badge tone="neutral" mono={false}>off by the deployment</Badge>
              : data.effective ? <Badge tone="success" mono={false}>on</Badge> : <Badge tone="neutral" mono={false}>off</Badge>}
          </div>
          <div className="small muted">
            {draft.enabled
              ? 'People can create personal keys on Connections & keys and use them, or sign in an assistant, to act as themselves.'
              : 'Personal keys cannot be created or used, and assistants are refused. Existing keys are kept and work again when this is turned back on.'}
          </div>
        </div>
        <Switch on={draft.enabled} onChange={(v) => patch({ enabled: v })} label="Allow AI assistants" disabled={save.isPending} />
      </div>

      {draft.browserSignIn !== null && (
        <div className="settings-row">
          <div className="flex-1 min-w-0">
            <div className="fw-medium text-base">Allow sign-in with a browser (OAuth)</div>
            <div className="small muted">
              {draft.browserSignIn
                ? 'An assistant added without a key opens the sign-in page; the person signs in with a second factor and chooses what it may do. They see it under Signed-in apps and can disconnect it.'
                : 'Assistants need a personal key. Apps already signed in with a browser are refused until this is turned back on.'}
            </div>
          </div>
          <Switch on={draft.browserSignIn} onChange={(v) => patch({ browserSignIn: v })} label="Allow sign-in with a browser (OAuth)" disabled={save.isPending || !draft.enabled} />
        </div>
      )}

      {draft.browserSignIn && (
        <div className="row wrap gap-12">
          <Field label="Longest sign-in" hint="After this, the app signs in again in the browser. Applies to new sign-ins.">
            <Select value={draft.oauthMaxDays} onChange={(e) => patch({ oauthMaxDays: Number(e.target.value) })}>
              {[...new Set([...DAY_CHOICES, draft.oauthMaxDays])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
            </Select>
          </Field>
          <Field label="Protected actions after sign-in" hint="Publishing a site, changing an address, granting a group: allowed for this long on the second factor proven at sign-in.">
            <Select value={draft.protectedHours} onChange={(e) => patch({ protectedHours: Number(e.target.value) })}>
              {[...new Set([...PROTECTED_HOUR_CHOICES, draft.protectedHours])].sort((a, b) => a - b).map((h) => (
                <option key={h} value={h}>{h === 0 ? 'Never' : h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <Field
        label="MCP server address"
        hint="Shown to people on Connections & keys, with the client configuration to paste. Empty: the console's own setting, if it has one."
        error={problems.serverUrl}
      >
        <Input mono value={draft.serverUrl} onChange={(e) => patch({ serverUrl: e.target.value })} placeholder="https://mcp.example.com/mcp" />
      </Field>

      <Field label="Longest a personal key may live" hint={`New keys only; keys already created keep their expiry. ${MCP_MAX_DAYS} days is the platform's maximum.`}>
        <Select value={draft.maxDays} onChange={(e) => patch({ maxDays: Number(e.target.value) })}>
          {[...new Set([...DAY_CHOICES, draft.maxDays])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
        </Select>
      </Field>

      <div className="settings-row">
        <div className="flex-1 min-w-0">
          <div className="fw-medium text-base">Groups</div>
          <div className="small muted">
            {draft.scope === 'all'
              ? 'Everyone who can sign in to the console may use it, with their own permissions.'
              : 'Only members of the groups below. Anyone else is refused, including with a key they already have.'}
          </div>
        </div>
        <Segmented
          label="Groups"
          value={draft.scope}
          onChange={(v) => patch({ scope: v })}
          options={[{ value: 'all', label: 'All groups' }, { value: 'selected', label: 'Only some' }]}
        />
      </div>

      {draft.scope === 'selected' && (
        <Field label="Allowed groups" error={problems.groups} required>
          <ChecklistGroups
            label="Allowed groups"
            groups={[{ id: 'groups', label: 'Groups', options: groupOptions }]}
            value={draft.groups}
            onChange={(next) => patch({ groups: next })}
          />
        </Field>
      )}

      <div className="row wrap gap-8 mt-12">
        <Button variant="primary" onClick={() => submit()} disabled={!dirty || !!problems.serverUrl || !!problems.groups} loading={save.isPending}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => setDraft(toMcpDraft(data.settings))} disabled={!dirty || save.isPending}>
          Discard changes
        </Button>
        <span className="small muted">Saving needs settings.mcp:write and a second factor confirmed in the last 15 minutes. Every change is audited.</span>
      </div>
    </Card>
  );
}
