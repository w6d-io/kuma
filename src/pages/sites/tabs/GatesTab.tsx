import { useState } from 'react';
import { Badge, Button, ButtonBase, Callout, Card, Drawer, Field, I, Input, RadioGroup, Segmented, Switch, cx } from '../../../components/ui';
import { useSitesPlatform } from '../../../api/sites';
import {
  FAILS_LABEL, GETS, GETS_LABEL, PASS_LABEL, WHO, WHO_LABEL, isCustomized, missingHandlers, presetsOf, withPreset, SANDBOX_ENABLED,
  type FailsPreset, type GetsPreset, type PassPreset, type WhoPreset,
} from '../../../lib/sites/presets';
import type { Gate, Site } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';
import type { Go } from '../SiteDetail';
import { CheckList, LockedCallout, MethodChips } from '../parts';
import { checkLines } from '../../../lib/sites/format';
import { GateAdvanced } from './GateAdvanced';
import { GateExpert } from './GateExpert';

/**
 * Gates (site-ux.md §7): how callers prove who they are. Cards for every gate; the selected one as
 * four questions (Basic), every handler field (Advanced), or raw JSON and the match pattern
 * (Expert). A gate with anything beyond a preset says "Customized" even in Basic.
 */

type Level = 'basic' | 'advanced' | 'expert';

export function GatesTab({ ed, readOnly, query, go }: { ed: SiteEditor; readOnly: boolean; query: Record<string, string>; go: Go }) {
  const site = ed.site;
  const platform = useSitesPlatform();
  const enabled = platform.data?.enabled ?? SANDBOX_ENABLED;
  const [locked, setLocked] = useState<string | null>(null);
  if (!site) return <Callout tone="warning" icon={I.alert}>This draft is incomplete.</Callout>;

  const selectedId = site.gates.some((g) => g.id === query.gate) ? query.gate : site.gates[0]?.id;
  const gate = site.gates.find((g) => g.id === selectedId);
  const level: Level = (['basic', 'advanced', 'expert'] as const).find((l) => l === query.level) ?? 'basic';
  const select = (g: string, l: Level = level) => go('gates', { gate: g, level: l === 'basic' ? undefined : l });
  const setGate = (next: Gate) => ed.update((s) => ({ ...s, gates: s.gates.map((g) => (g.id === gate!.id ? next : g)) }));
  const setSite = (fn: (s: Site) => Site) => ed.update(fn);
  const items = site.routes.items;

  const addGate = () => {
    let n = site.gates.length + 1;
    while (site.gates.some((g) => g.id === `gate-${n}`)) n++;
    const g: Gate = { id: `gate-${n}`, label: `Gate ${n}`, authenticators: WHO['signed-in'], authorizer: 'policy', mutators: GETS.identity, errors: 'website' };
    ed.update((s) => ({ ...s, gates: [...s.gates, g] }));
    select(g.id);
  };
  const removeGate = (id: string) => ed.update((s) => ({ ...s, gates: s.gates.filter((g) => g.id !== id) }));
  const gateChecks = ed.preview.state === 'ok' ? ed.preview.preview.checks.filter((c) => c.path?.startsWith('gates')) : [];

  return (
    <div className="stack gap-16">
      <div className="site-gate-cards">
        {site.gates.map((g) => {
          const n = items.filter((r) => r.gate === g.id && r.access.kind !== 'deny').length;
          const catchAll = site.routes.catchAll.gate === g.id;
          return (
            <ButtonBase key={g.id} className={cx('site-gate-card', g.id === selectedId && 'on')} aria-pressed={g.id === selectedId} onClick={() => select(g.id)}>
              <span className="row gap-8 items-center"><span className="fw-medium">{g.label}</span>{isCustomized(g) && <Badge tone="info" mono={false}>Customized</Badge>}</span>
              <span className="small muted">{WHO_LABEL[presetsOf(g).who as WhoPreset] ?? 'Custom sign-in'}</span>
              <span className="small">{n} route{n === 1 ? '' : 's'}{catchAll ? ' · everything else' : ''}{g.preflight ? ' · + browser pre-flight' : ''}</span>
            </ButtonBase>
          );
        })}
        {!readOnly && <Button icon={I.plus} onClick={addGate}>Add gate</Button>}
      </div>

      {gate && (
        <Card
          className={cx(level === 'expert' && 'site-expert')}
          title={gate.label}
          sub={<span className="mono">{gate.id}</span>}
          actions={<Segmented label="Detail level" value={level} onChange={(l) => select(gate.id, l)} options={[{ value: 'basic', label: 'Basic' }, { value: 'advanced', label: 'Advanced' }, { value: 'expert', label: 'Expert' }]} />}
        >
          {level === 'basic' && <GateBasic gate={gate} site={site} enabled={enabled} readOnly={readOnly} onChange={setGate} onSite={setSite} onLocked={setLocked} />}
          {level === 'advanced' && <GateAdvanced gate={gate} site={site} enabled={enabled} readOnly={readOnly} onChange={setGate} onLocked={setLocked} />}
          {level === 'expert' && <GateExpert gate={gate} preview={ed.preview} readOnly={readOnly} onChange={setGate} />}
          {gateChecks.length > 0 && <CheckList className="mt-12" lines={checkLines(gateChecks)} />}
          {!readOnly && site.gates.length > 1 && (
            <div className="row justify-end mt-12">
              <Button
                variant="danger"
                size="sm"
                icon={I.trash}
                disabled={site.routes.catchAll.gate === gate.id || items.some((r) => r.gate === gate.id)}
                title={site.routes.catchAll.gate === gate.id || items.some((r) => r.gate === gate.id) ? 'Move its routes to another gate first' : undefined}
                onClick={() => { removeGate(gate.id); select(site.gates.find((g) => g.id !== gate.id)!.id); }}
              >
                Remove gate
              </Button>
            </div>
          )}
        </Card>
      )}
      {platform.data?.source === 'default' && <p className="small muted">The gateway’s enabled handlers could not be read; the sandbox set is assumed.</p>}

      <Drawer open={!!locked} onClose={() => setLocked(null)} title="Needs a platform change">
        {locked && <LockedCallout handler={locked} />}
      </Drawer>
    </div>
  );
}

function GateBasic({ gate, site, enabled, readOnly, onChange, onSite, onLocked }: {
  gate: Gate; site: Site; enabled: typeof SANDBOX_ENABLED; readOnly: boolean;
  onChange: (g: Gate) => void; onSite: (fn: (s: Site) => Site) => void; onLocked: (h: string) => void;
}) {
  const p = presetsOf(gate);
  const lockHint = (missing: string[]) => missing.length
    ? <span>needs “{missing[0]}” — <Button size="sm" variant="ghost" onClick={() => onLocked(missing[0])}>how to enable</Button></span>
    : undefined;
  const whoOpts = (Object.keys(WHO) as WhoPreset[]).map((k) => {
    const missing = missingHandlers(WHO[k], enabled.authenticators);
    return { value: k, label: WHO_LABEL[k], hint: lockHint(missing), disabled: readOnly || missing.length > 0 };
  });
  const noSubject = p.who === 'anyone';
  const custom = (q: string) => <Badge tone="info" mono={false}>Customized — see Advanced ({q})</Badge>;

  return (
    <div className="site-questions">
      <section>
        <h4>1 Who is calling?</h4>
        {p.who === 'custom' && custom('sign-in methods')}
        <RadioGroup label="Who is calling?" name={`who-${gate.id}`} value={p.who === 'custom' ? ('' as WhoPreset) : p.who} disabled={readOnly} onChange={(v) => onChange(withPreset(gate, 'who', v))} options={whoOpts} />
      </section>
      <section>
        <h4>2 Who may pass?</h4>
        {p.pass === 'custom' && custom('authorizer')}
        <RadioGroup<PassPreset> label="Who may pass?" name={`pass-${gate.id}`} value={p.pass === 'custom' ? ('' as PassPreset) : p.pass} disabled={readOnly} onChange={(v) => onChange(withPreset(gate, 'pass', v))} options={[
          { value: 'policy', label: PASS_LABEL.policy, disabled: noSubject || !enabled.authorizers.includes('remote_json'), hint: noSubject ? 'Anyone has no identity to check.' : undefined },
          { value: 'everyone', label: noSubject ? 'Everyone' : PASS_LABEL.everyone },
          { value: 'nobody', label: PASS_LABEL.nobody },
        ]} />
      </section>
      <section>
        <h4>3 What the service gets</h4>
        {p.gets === 'custom' && custom('mutators')}
        <RadioGroup<GetsPreset> label="What the service gets" name={`gets-${gate.id}`} value={p.gets === 'custom' ? ('' as GetsPreset) : p.gets} disabled={readOnly} onChange={(v) => onChange(withPreset(gate, 'gets', v))} options={(Object.keys(GETS) as GetsPreset[]).map((k) => {
          const missing = missingHandlers(GETS[k], enabled.mutators);
          return { value: k, label: GETS_LABEL[k], hint: lockHint(missing) ?? (k === 'nothing' && !noSubject ? 'Warning: the service may trust spoofed X-User-* headers.' : undefined), disabled: missing.length > 0 };
        })} />
      </section>
      <section>
        <h4>4 When access fails</h4>
        {p.fails === 'custom' && custom('error handlers')}
        <RadioGroup<FailsPreset> label="When access fails" name={`fails-${gate.id}`} value={p.fails === 'custom' ? ('' as FailsPreset) : p.fails} disabled={readOnly} onChange={(v) => onChange(withPreset(gate, 'fails', v))} options={(['website', 'api', 'platform'] as const).map((k) => ({ value: k, label: FAILS_LABEL[k] }))} />
      </section>
      <section>
        <h4>Also</h4>
        <div className="stack gap-8">
          <Field label="Label"><Input value={gate.label} disabled={readOnly} onChange={(e) => onChange({ ...gate, label: e.target.value.slice(0, 80) || gate.label })} /></Field>
          <Field label="Answer browser pre-flight (OPTIONS) without sign-in" inline hint="Adds a separate allow-all OPTIONS rule for this gate's paths — for APIs called from another origin.">
            <Switch on={!!gate.preflight} disabled={readOnly} label="Pre-flight" onChange={(on) => onChange({ ...gate, preflight: on || undefined })} />
          </Field>
          <Field label="Only these methods" hint="Empty = GET HEAD POST PUT PATCH DELETE.">
            <MethodChips value={gate.methods ?? []} disabled={readOnly} onChange={(m) => onChange({ ...gate, methods: m.length ? m : undefined })} />
          </Field>
          <Field label="Keep the visitor's domain (preserve host)" inline hint="Site-wide: turn on if the service builds links or cookies from the Host header.">
            <Switch on={!!site.upstream.preserveHost} disabled={readOnly} label="Preserve host" onChange={(on) => onSite((s) => ({ ...s, upstream: { ...s.upstream, preserveHost: on || undefined } }))} />
          </Field>
          <Field label="Remove path prefix" hint="Site-wide. Oathkeeper removes the first occurrence (a substring replace) — it must be a literal prefix of every path.">
            <Input mono placeholder="/api" disabled={readOnly} value={site.upstream.stripPath ?? ''} onChange={(e) => onSite((s) => ({ ...s, upstream: { ...s.upstream, stripPath: e.target.value || undefined } }))} />
          </Field>
        </div>
      </section>
    </div>
  );
}
