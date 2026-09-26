import { useEffect, useState } from 'react';
import { Button, Callout, Drawer, Field, I, Input, Segmented, Select } from '../../../components/ui';
import { sitesApi, notAvailable, type SiteError } from '../../../api/sites';
import { examplePath } from '../../../lib/sites/paths';
import { headerNameProblem, secretLooking } from '../../../lib/sites/validate';
import type { Gate, RenderResult, Site } from '../../../lib/sites/types';
import { CheckList, type CheckLine } from '../parts';

/**
 * Add a header the service receives (site-ux.md §7.3). Friendly tokens insert guarded templates, so
 * an anonymous or token caller renders an empty value instead of a gateway 500; the preview is the
 * exact Go template engine (gatekit `POST /render`) against a sample person and URL.
 */

const TOKENS: Array<{ group: string; label: string; tpl: string }> = [
  { group: 'Person', label: 'id', tpl: '{{ print .Subject }}' },
  { group: 'Person', label: 'email', tpl: '{{ if .Extra.identity }}{{ index .Extra.identity.traits "email" }}{{ end }}' },
  { group: 'Person', label: 'name', tpl: '{{ if .Extra.identity }}{{ index .Extra.identity.traits "name" }}{{ end }}' },
  { group: 'Person', label: 'sign-in strength (aal)', tpl: '{{ if .Extra }}{{ print .Extra.authenticator_assurance_level }}{{ end }}' },
  { group: 'Person', label: 'session id', tpl: '{{ if .Extra }}{{ print .Extra.id }}{{ end }}' },
  { group: 'Token', label: 'client id', tpl: '{{ if .Extra }}{{ print .Extra.client_id }}{{ end }}' },
  { group: 'Token', label: 'scopes', tpl: '{{ if .Extra }}{{ print .Extra.scope }}{{ end }}' },
  { group: 'Request', label: 'path', tpl: '{{ .MatchContext.URL.Path }}' },
  { group: 'Request', label: 'method', tpl: '{{ .MatchContext.Method }}' },
  { group: 'Request', label: 'host', tpl: '{{ .MatchContext.URL.Host }}' },
  { group: 'Request', label: 'query parameter…', tpl: '{{ .MatchContext.URL.Query.Get "name" }}' },
];

export function HeaderBuilder({ open, onClose, site, gate, existing, onAdd }: {
  open: boolean; onClose: () => void; site: Site; gate: Gate; existing: string[]; onAdd: (name: string, value: string) => void;
}) {
  const routes = site.routes.items.filter((r) => r.gate === gate.id);
  const samplePaths = [...new Set([...routes.map((r) => examplePath(r.path)), `${site.address.pathPrefix ?? ''}/`])];
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [as, setAs] = useState<'person' | 'anonymous'>('person');
  const [email, setEmail] = useState('');
  const [path, setPath] = useState(samplePaths[0] ?? '/');
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !value.trim()) { setResult(null); setError(null); return; }
    const t = setTimeout(async () => {
      try {
        const out = await sitesApi.render({
          template: value, kind: 'header', name: name || undefined,
          sample: { method: 'GET', url: `https://${site.address.host}${path}`, ...(as === 'anonymous' ? { anonymous: true } : email ? { email } : {}) },
        });
        setResult(out);
        setError(null);
      } catch (err) {
        setResult(null);
        setError(notAvailable(err) ? 'Preview is not available on this server yet.' : (err as SiteError).status === 503 ? 'Checks are unavailable (gatekit did not answer).' : (err as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [open, value, name, as, email, path, site.address.host]);

  const nameErr = name ? headerNameProblem(name, existing) : null;
  const blocks =
    (/toJson\s+\.Extra\b/.test(value) && 'toJson .Extra can exceed the header size limit; pick one field.')
    || (secretLooking(value) && 'That value looks like a secret. Gateway rules are readable inside the cluster.')
    || null;
  const lines: CheckLine[] = [];
  if (result?.error) lines.push({ level: 'error', text: `Does not render: ${result.error}` });
  else if (result) {
    lines.push({ level: 'ok', text: <>{name || 'Header'}: <span className="mono">{result.value === '' ? '"" (sent empty)' : result.value}</span> · {result.bytes} bytes</> });
    if (result.bytes > 1024) lines.push({ level: 'warn', text: 'Over 1 KB rendered — large headers can be refused by proxies.' });
    result.warnings?.forEach((w) => lines.push({ level: 'warn', text: w }));
  }
  if (error) lines.push({ level: 'warn', text: error });
  const ok = !!name && !nameErr && !!value.trim() && !blocks && !result?.error;

  return (
    <Drawer open={open} onClose={onClose} title="Add a header the service receives" footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!ok} onClick={() => { onAdd(name, value); setName(''); setValue(''); }}>Add to draft</Button>
    </>}>
      <div className="stack gap-12">
        <Field label="Header name" error={nameErr ?? undefined} hint={name && !nameErr ? 'Not used by the platform headers.' : undefined}>
          <Input mono value={name} placeholder="X-Payroll-Org" onChange={(e) => setName(e.target.value.trim())} autoFocus />
        </Field>
        <Field label="Value" error={blocks ?? undefined}>
          <Input mono value={value} placeholder="{{ print .Subject }}" onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Insert">
          <Select value="" onChange={(e) => { if (e.target.value) setValue((v) => v + e.target.value); }}>
            <option value="">Pick a value to insert…</option>
            {['Person', 'Token', 'Request'].map((g) => (
              <optgroup key={g} label={g}>
                {TOKENS.filter((t) => t.group === g).map((t) => <option key={t.label} value={t.tpl}>{t.label}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <p className="small muted m-0">Org id from the path is not offered yet: generated patterns do not capture path parts.</p>
        <fieldset className="site-fieldset">
          <legend className="small fw-medium">Preview</legend>
          <div className="row gap-8 wrap items-center">
            <Segmented label="Preview as" value={as} onChange={setAs} options={[{ value: 'person', label: 'A person' }, { value: 'anonymous', label: 'Anonymous' }]} />
            {as === 'person' && <Input size="sm" aria-label="Sample email" placeholder="nina@acme.example" value={email} onChange={(e) => setEmail(e.target.value.trim())} />}
            <Select size="sm" mono aria-label="Sample URL" value={path} onChange={(e) => setPath(e.target.value)}>
              {samplePaths.map((p) => <option key={p} value={p}>GET {p}</option>)}
            </Select>
          </div>
          <CheckList lines={lines.length ? lines : [{ level: 'info', text: 'Type a value to see what the service would receive.' }]} />
        </fieldset>
        <Callout tone="info" icon={I.info}>
          Applying this change gives the gateway rule a new id so the new value takes effect at once (the gateway caches header templates per rule id).
        </Callout>
      </div>
    </Drawer>
  );
}
