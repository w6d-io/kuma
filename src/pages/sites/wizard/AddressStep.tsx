import { useEffect, useRef, useState } from 'react';
import { Badge, Field, I, Input, Select } from '../../../components/ui';
import { sitesApi, notAvailable, type SiteError } from '../../../api/sites';
import { describePaste, detectPaste } from '../../../lib/sites/paste';
import { labelProblem, nameProblem, namespaceProblem, portProblem, serviceProblem } from '../../../lib/sites/validate';
import type { WizardState } from '../../../lib/sites/wizard';
import type { HostCheck, Zone } from '../../../lib/sites/types';
import { CheckList, type CheckLine } from '../parts';

/**
 * Step 1 — Address (site-ux.md §4.1): one smart field that understands what is pasted, the public
 * address under a zone with the live host check, where it runs inside the cluster, and the name.
 */

type Probe = Awaited<ReturnType<typeof sitesApi.probe>>;

function hostLines(c: HostCheck | null, error: string | null): CheckLine[] {
  if (error) return [{ level: 'warn', text: error }];
  if (!c) return [];
  const lines: CheckLine[] = [];
  const blocking = c.checks.filter((x) => x.level === 'error');
  if (blocking.length === 0) lines.push({ level: 'ok', text: c.sharedWith.length ? `Shares the address with ${c.sharedWith.join(', ')} — your path prefix keeps them apart.` : 'Available' });
  if (c.zone) lines.push({ level: 'ok', text: `DNS: covered by *.${c.zone}` });
  if (c.tls === 'wildcard') lines.push({ level: 'ok', text: 'HTTPS: covered by the wildcard certificate' });
  if (c.tls === 'per-site') lines.push({ level: 'warn', text: 'Needs its own certificate (issued automatically, ~1 min)' });
  if (c.zone && c.sso) lines.push({ level: 'ok', text: `Single sign-on: shares the ${c.cookieDomain} session` });
  for (const x of c.checks) lines.push({ level: x.level === 'error' ? 'error' : 'warn', text: x.code === 'host_taken' && c.owner ? `${x.message}. Open it, or add a path like /v2 to share the address.` : x.message });
  return lines;
}

export function AddressStep({ s, patch, zones, problems }: { s: WizardState; patch: (p: Partial<WizardState>) => void; zones: Zone[]; problems: string[] }) {
  const [check, setCheck] = useState<HostCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probeState, setProbeState] = useState<'idle' | 'running' | 'unavailable' | 'failed'>('idle');
  const host = s.label && s.zone ? `${s.label}.${s.zone}` : '';
  const pasted = detectPaste(s.paste, zones.map((z) => z.suffix));

  // Host check, debounced — the server knows zones, owners, reserved hosts and SSO.
  useEffect(() => {
    if (!host || labelProblem(s.label)) { setCheck(null); setCheckError(null); return; }
    const t = setTimeout(async () => {
      try {
        setCheck(await sitesApi.checkHost({ host, ...(s.pathPrefix ? { pathPrefix: s.pathPrefix } : {}), ...(s.name && !nameProblem(s.name) ? { site: s.name } : {}) }));
        setCheckError(null);
      } catch (err) {
        setCheck(null);
        setCheckError(notAvailable(err) ? 'The host check is not available on this server yet.' : (err as SiteError).message);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [host, s.label, s.pathPrefix, s.name]);

  // Upstream probe (§4.1) — SSRF-fenced on the server; optional.
  useEffect(() => {
    if (serviceProblem(s.service) || namespaceProblem(s.namespace) || portProblem(s.port)) { setProbe(null); setProbeState('idle'); return; }
    const t = setTimeout(async () => {
      setProbeState('running');
      try {
        setProbe(await sitesApi.probe(`http://${s.service}.${s.namespace}:${s.port}`));
        setProbeState('idle');
      } catch (err) {
        setProbe(null);
        setProbeState(notAvailable(err) ? 'unavailable' : 'failed');
      }
    }, 500);
    return () => clearTimeout(t);
  }, [s.service, s.namespace, s.port]);

  // What was last understood, so leaving the field does not undo edits made below it since.
  const applied = useRef<string | null>(null);
  function applyPaste(text: string) {
    if (text === applied.current) return;
    applied.current = text;
    const p = detectPaste(text, zones.map((z) => z.suffix));
    const next: Partial<WizardState> = { paste: text };
    if (p.kind === 'public') Object.assign(next, { label: p.label, zone: p.zone, pathPrefix: p.pathPrefix ?? '' });
    if (p.kind === 'upstream' || (p.kind === 'openapi' && p.upstream)) {
      const u = p.kind === 'upstream' ? p : p.upstream!;
      Object.assign(next, { service: u.service, namespace: u.namespace, port: String(u.port) });
    }
    if (p.kind === 'name') Object.assign(next, { label: p.name, service: s.service || p.name, namespace: s.namespace || p.name });
    const nameFrom = p.kind === 'public' ? p.label : p.kind === 'name' ? p.name : p.kind === 'upstream' ? p.service : null;
    if (nameFrom && !s.nameTouched) Object.assign(next, { name: nameFrom, displayName: nameFrom.charAt(0).toUpperCase() + nameFrom.slice(1) });
    patch(next);
  }

  const probeLines: CheckLine[] = probeState === 'running' ? [{ level: 'pending', text: 'Checking it answers…' }]
    : probeState === 'unavailable' ? [{ level: 'info', text: 'Reachability check not available on this server yet — the site answers 502 until the service is up; you can still continue.' }]
    : probeState === 'failed' ? [{ level: 'warn', text: 'Could not check it answers. You can still continue.' }]
    : probe ? [
      probe.denied ? { level: 'error', text: `This address is platform-internal and can't be published (${probe.denied}).` }
        : probe.reachable ? { level: 'ok', text: `Reachable · ${probe.status} in ${probe.latencyMs} ms${probe.kind === 'html' ? ' · looks like a web app (HTML)' : probe.kind === 'json' ? ' · looks like an API (JSON)' : ''}` }
        : { level: 'warn', text: 'Refused or timed out — the site will answer 502 until it is up; you can still continue.' },
      ...(probe.openapi ? [{ level: 'ok' as const, text: `API description found at ${probe.openapi.url} · ${probe.openapi.operations} operations` }] : []),
    ] : [];

  return (
    <div className="stack gap-16">
      <Field label="Paste anything" hint="A public URL, an internal address or an OpenAPI link — we fill in the rest when you paste, press Enter or leave the field.">
        <Input
          value={s.paste}
          autoFocus
          placeholder="Paste a public URL, an internal address or an OpenAPI link"
          onChange={(e) => patch({ paste: e.target.value })}
          onPaste={(e) => { const text = e.clipboardData.getData('text'); e.preventDefault(); applyPaste(text.trim()); }}
          onBlur={() => applyPaste(s.paste)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPaste(s.paste); } }}
        />
      </Field>
      {s.paste && <div><Badge tone={pasted.kind === 'unknown' || pasted.kind === 'outside' ? 'warning' : 'info'} mono={false} icon={I.sparkle}>{describePaste(pasted)}</Badge></div>}

      <fieldset className="site-fieldset">
        <legend className="fw-medium">Public address</legend>
        <div className="site-host-row">
          <Field label="Label" error={s.label ? labelProblem(s.label) ?? undefined : undefined}>
            <Input mono value={s.label} placeholder="payroll" onChange={(e) => patch({ label: e.target.value.toLowerCase().trim() })} />
          </Field>
          <Field label="Zone">
            {zones.length > 0 ? (
              <Select mono value={s.zone} onChange={(e) => patch({ zone: e.target.value })}>
                {zones.map((z) => <option key={z.suffix} value={z.suffix}>.{z.suffix}</option>)}
              </Select>
            ) : <Input mono value={s.zone} placeholder="dev.stairling.com" onChange={(e) => patch({ zone: e.target.value.toLowerCase().trim() })} />}
          </Field>
          <Field label="Path (optional)" hint="Only to share a host.">
            <Input mono value={s.pathPrefix} placeholder="/" onChange={(e) => patch({ pathPrefix: e.target.value.trim() === '/' ? '' : e.target.value.trim() })} />
          </Field>
        </div>
        <CheckList lines={hostLines(check, checkError)} />
      </fieldset>

      <fieldset className="site-fieldset">
        <legend className="fw-medium">Runs at (inside the cluster)</legend>
        <p className="small muted m-0">The Service inside the cluster, like payroll-ui in namespace payroll on port 8080. Only the platform can reach it.</p>
        <div className="site-host-row">
          <Field label="Service" error={s.service ? serviceProblem(s.service) ?? undefined : undefined}><Input mono value={s.service} placeholder="payroll-ui" onChange={(e) => patch({ service: e.target.value.toLowerCase().trim() })} /></Field>
          <Field label="Namespace" error={s.namespace ? namespaceProblem(s.namespace) ?? undefined : undefined}><Input mono value={s.namespace} placeholder="payroll" onChange={(e) => patch({ namespace: e.target.value.toLowerCase().trim() })} /></Field>
          <Field label="Port" error={portProblem(s.port) ?? undefined}><Input mono inputMode="numeric" value={s.port} onChange={(e) => patch({ port: e.target.value.trim() })} /></Field>
        </div>
        <CheckList lines={probeLines} />
      </fieldset>

      <div className="site-host-row">
        <Field label="Name" hint={`Used in permissions: ${s.name || 'payroll'}:read …`} error={s.name ? nameProblem(s.name) ?? undefined : undefined}>
          <Input mono value={s.name} placeholder="payroll" onChange={(e) => patch({ name: e.target.value.toLowerCase().trim(), nameTouched: true })} />
        </Field>
        <Field label="Display name"><Input value={s.displayName} placeholder="Payroll" maxLength={80} onChange={(e) => patch({ displayName: e.target.value, nameTouched: true })} /></Field>
      </div>
      {problems.length > 0 && (s.label || s.service) && <p className="small muted m-0">Still needed: {problems.join(' · ')}</p>}
    </div>
  );
}
