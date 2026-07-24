import { useState, useMemo, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from './ui/Icons';
import { Drawer, Chip, Method } from './ui/Primitives';
import { useApplyChange } from '../hooks/useApplyChange';
import { useImportPreview, useUpdateServiceRoutes } from '../api/hooks';
import { PermSelect, UNSET_PERM } from '../pages/Routes';
import type { ImportPreview, DerivedRoute } from '../api/client';
import type { RouteEntry } from '../api/types';

type SourceMode = 'url' | 'file' | 'paste';
type Status = 'new' | 'changed' | 'unchanged';

interface WorkRow {
  method: string;
  path: string;
  permission: string; // '' = public, UNSET_PERM = unresolved, else the permission
  source: string;
  status: Status;
  from?: (string | null)[];
}
interface StaleRow { method: string; path: string; permission?: string; isCatchall: boolean; remove: boolean; }

const permOf = (d: DerivedRoute): string =>
  d.source === 'unmapped' ? UNSET_PERM : d.public ? '' : d.permission ?? '';

function buildRows(p: ImportPreview): WorkRow[] {
  const rows: WorkRow[] = [];
  for (const d of p.diff.add) rows.push({ method: d.method, path: d.path, permission: permOf(d), source: d.source, status: 'new' });
  for (const c of p.diff.changed) rows.push({ method: c.method, path: c.path, permission: permOf(c.to), source: c.to.source, status: 'changed', from: c.from });
  for (const d of p.diff.unchanged) rows.push({ method: d.method, path: d.path, permission: permOf(d), source: d.source, status: 'unchanged' });
  return rows.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

const STATUS_COLOR: Record<Status | 'stale', string> = {
  new: 'var(--ok, #0E9F6E)', changed: 'var(--warn, #B7791F)', unchanged: 'var(--muted, #888)', stale: 'var(--danger, #c0392b)',
};
function StatusTag({ s }: { s: Status | 'stale' }) {
  return <span className="small mono" style={{ color: STATUS_COLOR[s], fontWeight: 600 }}>{s === 'stale' ? 'remove' : s}</span>;
}

export function ImportRoutesDrawer({ svc, open, onClose }: { svc: string; open: boolean; onClose: () => void }) {
  const { state, pushToast } = useApp();
  const applyChange = useApplyChange();
  const preview = useImportPreview(svc);
  const updateRoutes = useUpdateServiceRoutes(svc);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'source' | 'review' | 'done'>('source');
  const [mode, setMode] = useState<SourceMode>('url');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [resourceFrom, setResourceFrom] = useState<'tag' | 'path' | 'operationId'>('tag');
  const [listAsRead, setListAsRead] = useState(false);
  const [honorExtension, setHonorExtension] = useState(true);
  const [basePath, setBasePath] = useState<'prepend' | 'strip' | 'none'>('prepend');

  const [data, setData] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [stale, setStale] = useState<StaleRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'new' | 'changed' | 'stale'>('all');
  const [search, setSearch] = useState('');
  const [prior, setPrior] = useState<RouteEntry[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);

  // Perm options for the inline PermSelect: the service's role perms + anything
  // the import derived (so custom-derived perms are pickable, not just typeable).
  const perms = useMemo(() => {
    const set = new Set<string>();
    for (const ps of Object.values(state.roles[svc] || {})) for (const p of ps) if (p !== '*') set.add(p);
    for (const r of rows) if (r.permission && r.permission !== UNSET_PERM) set.add(r.permission);
    return Array.from(set).sort();
  }, [state.roles, svc, rows]);

  const reset = () => {
    setStep('source'); setData(null); setRows([]); setStale([]); setFilter('all'); setSearch(''); setAppliedCount(0);
  };
  const close = () => { reset(); onClose(); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFilename(f.name);
    setContent(await f.text());
  };

  const analyze = () => {
    const fmt: 'json' | 'yaml' | 'auto' = /\.ya?ml$/i.test(filename) ? 'yaml' : /\.json$/i.test(filename) ? 'json' : 'auto';
    const source = mode === 'url' ? { url: url.trim() } : { content, format: fmt };
    preview.mutate(
      { source, options: { resourceFrom, listAsRead, honorExtension, basePath } },
      {
        onSuccess: (p) => { setData(p); setRows(buildRows(p)); setStale(p.diff.stale.map((s) => ({ ...s, remove: true }))); setStep('review'); },
        onError: (e: any) => pushToast(e?.message || 'Could not parse the spec', { err: true }),
      },
    );
  };

  const unresolved = rows.filter((r) => r.permission === UNSET_PERM).length;
  const finalRules: RouteEntry[] = [
    ...rows.map((r) => ({ method: r.method, path: r.path, ...(r.permission && r.permission !== UNSET_PERM ? { permission: r.permission } : {}) })),
    ...stale.filter((s) => !s.remove).map((s) => ({ method: s.method, path: s.path, ...(s.permission ? { permission: s.permission } : {}) })),
  ];

  const apply = () => {
    if (unresolved > 0) return;
    setPrior([...(state.routeMaps[svc] || [])]);
    const rules = finalRules;
    const p = updateRoutes.mutateAsync(rules);
    applyChange('import', `route_map.${svc}: imported ${rules.length} route(s)`, () => p.then(() => {}));
    p.then(() => { setAppliedCount(rules.length); setStep('done'); }).catch(() => {});
  };
  const undo = () => {
    const p = updateRoutes.mutateAsync(prior);
    applyChange('update', `route_map.${svc}: undo import`, () => p.then(() => {}));
    p.then(() => close()).catch(() => {});
  };

  const counts = {
    add: rows.filter((r) => r.status === 'new').length,
    changed: rows.filter((r) => r.status === 'changed').length,
    unchanged: rows.filter((r) => r.status === 'unchanged').length,
    stale: stale.length,
  };
  const catchalls = stale.filter((s) => s.isCatchall);

  const shownRows = rows.filter((r) => {
    if (filter === 'stale') return false;
    if (filter !== 'all' && r.status !== filter) return false;
    if (search && !r.path.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const showStale = (filter === 'all' || filter === 'stale') && stale.length > 0;

  // Plain-language live preview of how the naming settings map a sample service.
  // Uses a "Billing" group living at /invoices so the resource-source choice is
  // visibly different (billing vs invoices).
  const exampleRows = () => {
    const res = resourceFrom === 'tag' ? 'billing' : 'invoices';
    const base = basePath === 'none' ? '' : '/api/v1';
    const listV = listAsRead ? 'read' : 'list';
    return [
      { m: 'GET', path: `${base}/invoices`, perm: `${res}:${listV}` },
      { m: 'GET', path: `${base}/invoices/:id`, perm: `${res}:read` },
      { m: 'POST', path: `${base}/invoices`, perm: `${res}:create` },
      { m: 'DELETE', path: `${base}/invoices/:id`, perm: `${res}:delete` },
      { m: 'GET', path: `${base}/health`, perm: honorExtension ? 'public' : 'health:read', pub: honorExtension },
    ];
  };
  const resourceLabel = { tag: 'the category', path: 'the web address', operationId: 'the operation name' }[resourceFrom];

  // ── footers ──
  const sourceFooter = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <button className="btn ghost" onClick={close}>Cancel</button>
      <button className="btn primary" onClick={analyze} disabled={preview.isPending || (mode === 'url' ? !url.trim() : !content.trim())}>
        {preview.isPending ? 'Analyzing…' : 'Analyze spec'}
      </button>
    </div>
  );
  const reviewFooter = (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="small mono muted">
        <b style={{ color: STATUS_COLOR.new }}>+{counts.add}</b> &nbsp;
        <b style={{ color: STATUS_COLOR.changed }}>~{counts.changed}</b> &nbsp;
        <b style={{ color: STATUS_COLOR.stale }}>−{stale.filter((s) => s.remove).length}</b> &nbsp;→ {finalRules.length} rules
      </span>
      <span style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost" onClick={() => setStep('source')}>Back</button>
        <button className="btn primary" onClick={apply} disabled={updateRoutes.isPending || unresolved > 0}
          title={unresolved > 0 ? `${unresolved} route(s) still need a permission` : ''}>
          {unresolved > 0 ? `Resolve ${unresolved} first` : `Apply import`}
        </button>
      </span>
    </div>
  );
  const doneFooter = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <button className="btn ghost" onClick={undo} disabled={updateRoutes.isPending}>Undo import</button>
      <button className="btn primary" onClick={close}>Done</button>
    </div>
  );

  return (
    <Drawer open={open} onClose={close} size="lg" eyebrow={`Service · ${svc}`} title="Import routes from OpenAPI"
      footer={step === 'source' ? sourceFooter : step === 'review' ? reviewFooter : doneFooter}>

      {step === 'source' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="small muted" style={{ margin: 0 }}>
            Parse a service&rsquo;s spec into explicit <span className="mono">method + path + permission</span> rules.
            Nothing is written until you review and apply.
          </p>
          <div className="seg">
            {(['url', 'file', 'paste'] as SourceMode[]).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'url' ? 'Fetch URL' : m === 'file' ? 'Upload file' : 'Paste'}
              </button>
            ))}
          </div>
          {mode === 'url' && (
            <input className="input mono" placeholder="https://service/openapi.json" value={url} onChange={(e) => setUrl(e.target.value)} />
          )}
          {mode === 'file' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input ref={fileRef} type="file" accept=".json,.yaml,.yml" style={{ display: 'none' }} onChange={onFile} />
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <span style={{ width: 13, height: 13, display: 'inline-grid', placeItems: 'center', marginRight: 6 }}>{I.upload}</span>
                Choose .json / .yaml
              </button>
              {filename && <span className="small mono muted">{filename}</span>}
            </div>
          )}
          {mode === 'paste' && (
            <textarea className="input mono" rows={8} placeholder="Paste OpenAPI JSON or YAML…" value={content} onChange={(e) => setContent(e.target.value)} />
          )}

          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced((v) => !v)}>
            {advanced ? '▾' : '▸'} How permissions are named
          </button>
          {!advanced && (
            <div className="small muted" style={{ marginTop: -6 }}>
              Named after {resourceLabel} · {listAsRead ? 'one “view” permission' : 'separate “view list” / “view one”'} · file permissions {honorExtension ? 'respected' : 'ignored'}. Smart defaults — most files need no change.
            </div>
          )}
          {advanced && (
            <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p className="small muted" style={{ margin: 0 }}>
                Each endpoint in your file becomes a rule: <b>who</b> may do <b>what</b>. The action
                (read, create, update, delete) is detected from the request automatically — these settings decide the rest.
              </p>

              {/* 1 — where the name comes from */}
              <div>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Name permissions after…</div>
                <div className="seg">
                  <button className={resourceFrom === 'tag' ? 'on' : ''} onClick={() => setResourceFrom('tag')}>Category</button>
                  <button className={resourceFrom === 'path' ? 'on' : ''} onClick={() => setResourceFrom('path')}>Web address</button>
                  <button className={resourceFrom === 'operationId' ? 'on' : ''} onClick={() => setResourceFrom('operationId')}>Operation name</button>
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  {resourceFrom === 'tag' && 'The group each endpoint is filed under — e.g. a “Billing” group becomes billing:read.'}
                  {resourceFrom === 'path' && 'The web address — e.g. /invoices becomes invoices:read.'}
                  {resourceFrom === 'operationId' && 'The endpoint’s internal name — e.g. listInvoices becomes invoices:read.'}
                </div>
              </div>

              {/* 2 — list vs one */}
              <label className="small" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={!listAsRead} onChange={(e) => setListAsRead(!e.target.checked)} style={{ marginTop: 2 }} />
                <span>
                  <b>Separate “view the whole list” from “view one item”</b>
                  <div className="muted">Seeing all invoices needs <span className="mono">invoices:list</span>; opening a single one needs <span className="mono">invoices:read</span>. Turn off to use one <span className="mono">read</span> for both.</div>
                </span>
              </label>

              {/* 3 — honor file-declared permissions */}
              <label className="small" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={honorExtension} onChange={(e) => setHonorExtension(e.target.checked)} style={{ marginTop: 2 }} />
                <span>
                  <b>Respect permissions already written in the file</b>
                  <div className="muted">If an endpoint states its own permission — or marks itself public — use that instead of guessing. Recommended.</div>
                </span>
              </label>

              {/* 4 — addresses */}
              <div>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Full addresses <span className="muted" style={{ fontWeight: 400 }}>· usually automatic</span></div>
                <div className="seg">
                  <button className={basePath === 'prepend' ? 'on' : ''} onClick={() => setBasePath('prepend')}>Add server prefix</button>
                  <button className={basePath === 'none' ? 'on' : ''} onClick={() => setBasePath('none')}>Already complete</button>
                  <button className={basePath === 'strip' ? 'on' : ''} onClick={() => setBasePath('strip')}>Remove prefix</button>
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  Makes the addresses match your gateway. Only change this if the preview below looks wrong — e.g. a doubled <span className="mono">/api/v1/api/v1/…</span>.
                </div>
              </div>

              {/* live preview */}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="small" style={{ fontWeight: 600 }}>Live preview</div>
                <div className="small muted" style={{ marginBottom: 8 }}>Example — a “Billing” group of endpoints at <span className="mono">/invoices</span>:</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ fontSize: 12.5 }}>
                    <tbody>
                      {exampleRows().map((r, i) => (
                        <tr key={i}>
                          <td style={{ width: 74 }}><Method m={r.m} /></td>
                          <td className="mono">{r.path}</td>
                          <td className="muted" style={{ width: 20, textAlign: 'center' }}>→</td>
                          <td>{r.pub ? <Chip tone="info">public · no login</Chip> : <Chip>{r.perm}</Chip>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'review' && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip tone="info">+{counts.add} new</Chip>
            <Chip>~{counts.changed} changed</Chip>
            <Chip tone="err">−{counts.stale} stale</Chip>
            <Chip>{counts.unchanged} unchanged</Chip>
            {data.detectedBasePath && <Chip>base {data.detectedBasePath} ({data.basePathMode})</Chip>}
          </div>

          {catchalls.length > 0 && (
            <div className="panel" style={{ padding: '10px 13px', borderColor: 'var(--danger, #c0392b)' }}>
              <span className="small"><b>{catchalls.length} catch-all rule(s) will be removed</b> — fail-open surfaces:{' '}
                <span className="mono">{catchalls.map((c) => `${c.method} ${c.path}`).join('  ')}</span>. Untick a row below to keep it.</span>
            </div>
          )}
          {data.warnings.filter((w) => w.kind !== 'catchall_removed').map((w, i) => (
            <div key={i} className="panel" style={{ padding: '10px 13px', borderColor: 'var(--accent)' }}>
              <span className="small">{w.message}{w.detail ? <> — <span className="mono muted">{w.detail}</span></> : null}</span>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="seg">
              {(['all', 'new', 'changed', 'stale'] as const).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
            <input className="input mono sm" style={{ marginLeft: 'auto', maxWidth: 220 }} placeholder="search paths…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th style={{ width: 84 }}>Method</th><th>Path</th><th style={{ width: 220 }}>Permission</th><th style={{ width: 90 }}>Source</th><th style={{ width: 80 }}>Status</th></tr></thead>
              <tbody>
                {shownRows.map((r) => {
                  const idx = rows.indexOf(r);
                  return (
                    <tr key={`${r.method} ${r.path}`}>
                      <td><Method m={r.method} /></td>
                      <td className="mono">{r.path}{r.status === 'changed' && r.from ? <div className="small muted">was: {r.from.map((f) => f ?? 'public').join(', ')}</div> : null}</td>
                      <td><PermSelect value={r.permission} perms={perms} onChange={(v) => setRows((rs) => rs.map((x, j) => (j === idx ? { ...x, permission: v } : x)))} /></td>
                      <td><span className="small mono muted">{r.source === 'extension' ? 'x-rbac' : r.source}</span></td>
                      <td><StatusTag s={r.status} /></td>
                    </tr>
                  );
                })}
                {showStale && stale.map((s, i) => (
                  <tr key={`stale ${s.method} ${s.path}`} style={{ opacity: s.remove ? 0.55 : 1 }}>
                    <td><Method m={s.method} /></td>
                    <td className="mono" style={{ textDecoration: s.remove ? 'line-through' : 'none' }}>{s.path}{s.isCatchall && <Chip tone="err">catch-all</Chip>}</td>
                    <td>{s.permission ? <Chip>{s.permission}</Chip> : <Chip tone="info">public</Chip>}</td>
                    <td><span className="small muted">not in spec</span></td>
                    <td>
                      <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <input type="checkbox" checked={s.remove} onChange={(e) => setStale((ss) => ss.map((x, j) => (j === i ? { ...x, remove: e.target.checked } : x)))} />
                        {s.remove ? <StatusTag s="stale" /> : 'keep'}
                      </label>
                    </td>
                  </tr>
                ))}
                {shownRows.length === 0 && !showStale && <tr><td colSpan={5}><span className="small muted">Nothing matches this filter.</span></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 20, height: 20, display: 'grid', placeItems: 'center', color: 'var(--ok, #0E9F6E)' }}>{I.check}</span>
            <h3 style={{ margin: 0 }}>Imported {appliedCount} route(s) into {svc}</h3>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            The route map is now the spec&rsquo;s. OPA picks it up within ~30s via OPAL. Not what you expected? Undo restores the previous {prior.length} rule(s).
          </p>
        </div>
      )}
    </Drawer>
  );
}
