import { useId, useState } from 'react';
import { Button, Field, I, Input, RadioGroup, Select, Switch } from '../../../components/ui';
import {
  displayPath, examplePath, formatSegments, guessOrgParam, normalizePath, orgParamProblem, parseSegments, pathParams, pathProblem,
  METHOD_PRESETS, type Segment,
} from '../../../lib/sites/paths';
import { allowsAnonymous } from '../../../lib/sites/presets';
import type { Access, Gate, Route } from '../../../lib/sites/types';
import { MethodChips } from '../parts';

/**
 * One route, edited inline (site-ux.md §6.1): methods as chips, the path as text or as parts, the
 * gate, the access level, and org scoping. No regex. Public moves the route to a gate that lets
 * anonymous callers in — never an error.
 */

type Kind = Access['kind'];

function PathBuilder({ path, onChange }: { path: string; onChange: (p: string) => void }) {
  const segs = parseSegments(path);
  const set = (next: Segment[]) => onChange(formatSegments(next));
  const hasRest = segs.some((s) => s.kind === 'rest');
  return (
    <div className="site-pathparts" role="group" aria-label="Path parts">
      <span className="muted mono">/</span>
      {segs.map((s, i) => (
        <span key={i} className="site-pathpart">
          {s.kind === 'rest'
            ? <span className="mono small">* rest of path</span>
            : <Input size="sm" mono aria-label={`Part ${i + 1}`} value={s.value} onChange={(e) => set(segs.map((x, j) => (j === i ? { ...x, value: e.target.value.replace(/[/:*]/g, '') } : x)))} />}
          <Select size="sm" aria-label={`Part ${i + 1} kind`} value={s.kind} onChange={(e) => {
            const kind = e.target.value as Segment['kind'];
            set(segs.map((x, j) => (j === i ? { kind, value: kind === 'rest' ? 'any' : x.value === 'any' ? 'id' : x.value } : x)).filter((_x, j) => kind !== 'rest' || j <= i));
          }}>
            <option value="exact">exact text</option>
            <option value="param">one segment (:name)</option>
            {(i === segs.length - 1 || s.kind === 'rest') && <option value="rest">rest of path (*)</option>}
          </Select>
          <Button size="sm" variant="ghost" iconOnly icon={I.close} aria-label={`Remove part ${i + 1}`} onClick={() => set(segs.filter((_, j) => j !== i))} />
        </span>
      ))}
      {!hasRest && <Button size="sm" variant="ghost" icon={I.plus} onClick={() => set([...segs, { kind: 'exact', value: 'part' }])}>part</Button>}
    </div>
  );
}

export function RouteEditor({ route, gates, permissions, rowNumber, problem, onChange, onDelete, onDone }: {
  route: Route;
  gates: Gate[];
  permissions: string[];
  rowNumber: number;
  problem?: string;
  onChange: (r: Route) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(displayPath(route.path));
  const listId = useId();
  const anonGate = gates.find(allowsAnonymous);
  const authGates = gates.filter((g) => !allowsAnonymous(g));
  const params = pathParams(route.path);
  const kind: Kind = route.access.kind;

  const setPath = (p: string) => {
    const path = normalizePath(p);
    const next: Route = { ...route, path };
    // Auto-on when a param looks like the org (platform default); off when the param is gone.
    const guess = guessOrgParam(path);
    if (!route.orgParam && guess) next.orgParam = guess;
    if (route.orgParam && !pathParams(path).includes(route.orgParam)) delete next.orgParam;
    onChange(next);
  };

  const setKind = (k: Kind) => {
    const access: Access = k === 'permission' ? { kind: 'permission', permission: permissions[0] ?? '' } : { kind: k } as Access;
    let gate = route.gate;
    if (k === 'public' && anonGate) gate = anonGate.id;
    if ((k === 'signed-in' || k === 'permission') && !authGates.some((g) => g.id === gate) && authGates[0]) gate = authGates[0].id;
    onChange({ ...route, access, gate });
  };

  const pathErr = pathProblem(route.path);
  const orgErr = route.orgParam ? orgParamProblem(route.path, route.orgParam) : null;
  const example = examplePath(route.path);
  const shorter = example.split('/').slice(0, -1).join('/') || '/';

  return (
    <div className="site-route-editor" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }}>
      <div className="row gap-8 wrap items-center">
        <span className="muted small">#{rowNumber}</span>
        <MethodChips value={route.methods} onChange={(methods) => onChange({ ...route, methods })} />
        <Select size="sm" aria-label="Method presets" value="" onChange={(e) => { const p = e.target.value as keyof typeof METHOD_PRESETS; if (p) onChange({ ...route, methods: METHOD_PRESETS[p] }); }}>
          <option value="">Presets…</option>
          <option value="read">Read (GET HEAD)</option>
          <option value="write">Write (POST PUT PATCH DELETE)</option>
          <option value="all">All</option>
        </Select>
      </div>

      <Field label="Path" hint="Type :name for one segment and * at the end for the rest of the path." error={pathErr ?? undefined}>
        <Input mono value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setPath(text)} onKeyDown={(e) => { if (e.key === 'Enter') setPath(text); }} autoFocus />
      </Field>
      <PathBuilder path={route.path} onChange={(p) => { setText(displayPath(p)); onChange({ ...route, path: p, ...(route.orgParam && !pathParams(p).includes(route.orgParam) ? { orgParam: undefined } : {}) }); }} />

      <div className="site-route-grid">
        <RadioGroup<Kind>
          label="Access"
          name={`access-${route.id}`}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'permission', label: 'Needs permission' },
            { value: 'signed-in', label: 'Signed-in', hint: 'any account' },
            { value: 'public', label: 'Public', hint: anonGate ? 'anyone, no sign-in' : 'needs a gate that lets anyone in — add a Public gate first', disabled: !anonGate },
            { value: 'deny', label: 'Refused', hint: 'everyone is refused' },
          ]}
        />
        <div className="stack gap-8">
          {kind === 'permission' && (
            <Field label="Permission" hint="resource:verb — a new name is created on save; add it to a role on Access.">
              <Input mono list={listId} value={route.access.kind === 'permission' ? route.access.permission : ''} onChange={(e) => onChange({ ...route, access: { kind: 'permission', permission: e.target.value.trim() } })} />
            </Field>
          )}
          <datalist id={listId}>{permissions.map((p) => <option key={p} value={p} />)}</datalist>
          {kind !== 'deny' && (
            <Field label="Gate" hint={kind === 'public' ? 'Public routes use a gate that lets anyone in.' : undefined}>
              <Select value={route.gate} onChange={(e) => onChange({ ...route, gate: e.target.value })}>
                {(kind === 'public' ? gates.filter(allowsAnonymous) : authGates.length ? authGates : gates).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </Select>
            </Field>
          )}
          <Field
            label="Org-scoped"
            inline
            hint={params.length === 0 ? 'Add :orgId to the path to make it org-scoped.' : 'Only members of the organization in the URL, using that organization’s grants.'}
            error={orgErr ?? undefined}
          >
            <Switch
              on={!!route.orgParam}
              disabled={params.length === 0}
              label="Org-scoped"
              onChange={(on) => onChange({ ...route, orgParam: on ? (guessOrgParam(route.path) ?? params[0]) : undefined })}
            />
          </Field>
          {route.orgParam && params.length > 1 && (
            <Field label="Organization comes from">
              <Select mono value={route.orgParam} onChange={(e) => onChange({ ...route, orgParam: e.target.value })}>
                {params.map((p) => <option key={p} value={p}>:{p}</option>)}
              </Select>
            </Field>
          )}
        </div>
      </div>

      {!pathErr && (
        <p className="small m-0">
          Matches e.g. <span className="mono">{example}</span> <span className="text-success">✓</span>
          {shorter !== example && !route.path.endsWith(':any*') && <> · <span className="mono">{shorter}</span> <span className="text-danger">✗</span></>}
        </p>
      )}
      {problem && <p className="field-error m-0">{problem}</p>}
      <div className="row gap-8 justify-end">
        <Button variant="danger" size="sm" icon={I.trash} onClick={onDelete}>Delete row</Button>
        <Button size="sm" variant="primary" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
