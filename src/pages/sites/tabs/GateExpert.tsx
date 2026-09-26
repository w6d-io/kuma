import { useState } from 'react';
import { Badge, Button, Callout, CodeView, Field, I, Input, Textarea } from '../../../components/ui';
import type { Gate } from '../../../lib/sites/types';
import { patternShape } from '../../../lib/sites/gateChecks';
import type { PreviewState } from '../useSiteEditor';
import { CheckList, type CheckLine } from '../parts';

/**
 * A gate in Expert (site-ux.md §6.5): the generated match URL, an override checked by gatekit on
 * every change (through the preview — no JS approximation), and the gate as raw JSON. An override
 * is marked Customized everywhere and "Reset to generated" removes it.
 */

export function GateExpert({ gate, preview, readOnly, onChange }: { gate: Gate; preview: PreviewState; readOnly: boolean; onChange: (g: Gate) => void }) {
  const rules = preview.state === 'ok' ? preview.preview.artefacts.rules.filter((r) => r.id.includes(`-${gate.id}-`) && !r.id.includes(`-${gate.id}-preflight-`)) : [];
  const generated = rules[0];
  const [override, setOverride] = useState(gate.expert?.matchUrl ?? '');
  const { expert: _omit, ...plain } = gate;
  void _omit;
  const [raw, setRaw] = useState(JSON.stringify(plain, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);

  const shape = override ? patternShape(override) : null;
  const serverChecks = preview.state === 'ok' ? preview.preview.checks.filter((c) => c.path?.startsWith('gates') && /pattern|overlap|expert/.test(c.code)) : [];
  const lines: CheckLine[] = [];
  if (gate.expert?.matchUrl) {
    if (preview.state === 'running') lines.push({ level: 'pending', text: 'Compiling and probing against every live rule…' });
    else if (preview.state === 'unavailable') lines.push({ level: 'error', text: preview.message });
    else if (preview.state === 'ok') {
      const errs = serverChecks.filter((c) => c.level === 'error');
      if (errs.length === 0) lines.push({ level: 'ok', text: 'Compiles and overlaps no live rule (gatekit).' });
      errs.forEach((c) => lines.push({ level: 'error', text: c.message }));
    }
  }

  const applyRaw = () => {
    try {
      const parsed = JSON.parse(raw) as Gate;
      if (parsed.id !== gate.id) throw new Error(`the id is managed ("${gate.id}"); rename the label instead`);
      if (!Array.isArray(parsed.authenticators) || !Array.isArray(parsed.mutators) || parsed.authorizer === undefined || parsed.errors === undefined) {
        throw new Error('authenticators, authorizer, mutators and errors are required');
      }
      setRawError(null);
      onChange({ ...parsed, ...(gate.expert ? { expert: gate.expert } : {}) });
    } catch (err) {
      setRawError((err as Error).message);
    }
  };

  return (
    <div className="stack gap-16">
      <div className="row gap-8 items-center wrap">
        <span className="small muted">Rule id</span>
        {generated ? <Badge>{generated.id}</Badge> : <span className="small muted">shown once the preview runs</span>}
        <span className="small muted">(the suffix changes when templates or the pattern change, so the gateway never serves a stale template)</span>
      </div>
      {generated && <CodeView code={generated.match.url} title={gate.expert?.matchUrl ? 'Match URL (override)' : 'Match URL (generated)'} wrap />}
      {generated && <p className="small m-0">Methods: <span className="mono">{generated.match.methods.join(' ')}</span>{gate.preflight ? ' · OPTIONS handled by the pre-flight rule' : ''}</p>}

      <Field label="Override pattern" hint="Oathkeeper regexp syntax: text outside < > is literal. Checked by the gateway’s own compiler and against every live rule." error={shape ?? undefined}>
        <Input mono value={override} disabled={readOnly} placeholder="<https?>://host/api<(/v[12])?(/.*)?>" onChange={(e) => setOverride(e.target.value)} />
      </Field>
      {!readOnly && (
        <div className="row gap-8">
          <Button size="sm" variant="primary" disabled={!override || !!shape || override === gate.expert?.matchUrl} onClick={() => onChange({ ...gate, expert: { matchUrl: override } })}>Use this pattern</Button>
          {gate.expert?.matchUrl && <Button size="sm" onClick={() => { setOverride(''); const { expert: _e, ...rest } = gate; void _e; onChange(rest); }}>Reset to generated</Button>}
        </div>
      )}
      {gate.expert?.matchUrl && <Callout tone="warning" icon={I.alert}>An override is high risk in Review: only gatekit vouches for it, and route changes no longer reshape it.</Callout>}
      <CheckList lines={lines} />

      <Field label="Gate as JSON" hint="Every field except the id. Edits here become per-gate overrides kept on the site; secret-looking values are refused." error={rawError ?? undefined}>
        <Textarea mono rows={14} value={raw} disabled={readOnly} onChange={(e) => setRaw(e.target.value)} />
      </Field>
      {!readOnly && <div><Button size="sm" onClick={applyRaw}>Apply JSON to the draft</Button></div>}
    </div>
  );
}
