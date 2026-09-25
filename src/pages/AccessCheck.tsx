import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useServices } from '../api/hooks';
import { orgAccessApi, type AccessCheckResult } from '../api/orgAccess';
import { METHODS, describeCheckError, explain, formFromQuery, requiredPermissions, validateCheck, type CheckForm } from '../lib/accessCheck';
import { formatHash, parseHash } from '../lib/route';
import { Chip, EmptyHint } from '../components/ui/Primitives';
import { I } from '../components/ui/Icons';

/**
 * "Why can't X do Y?" — asks the engine the same question the gateway asks, for somebody else, and
 * says the answer in words. The form is the address (`#/access-check?email=…&method=…&path=…`), so a
 * check can be pasted into a ticket and reopened as it was.
 */
export function AccessCheckPage() {
  const [form, setForm] = useState<CheckForm>(() => formFromQuery(parseHash(window.location.hash).query));
  const [problem, setProblem] = useState<string | null>(null);
  const services = useServices();
  const check = useMutation({ mutationFn: (f: CheckForm) => orgAccessApi.accessCheck(f) });

  const run = (f: CheckForm) => {
    const bad = validateCheck(f);
    setProblem(bad);
    if (bad) return;
    // Rewrite the address without a navigation, so the check is shareable and Back still leaves.
    history.replaceState(null, '', `#${formatHash('accesscheck', null, { ...f })}`);
    check.mutate(f);
  };

  // A link that arrives complete runs at once; a pasted one while the page is open does too.
  useEffect(() => {
    const fromLink = () => {
      const f = formFromQuery(parseHash(window.location.hash).query);
      setForm(f);
      if (f.email && f.path && !validateCheck(f)) check.mutate(f);
    };
    fromLink();
    window.addEventListener('hashchange', fromLink);
    return () => window.removeEventListener('hashchange', fromLink);
    // Runs on mount and on hash changes only; `check.mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof CheckForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Access checker</h1>
          <div className="sub">Ask whether a person can call a route, and why — the same question the gateway asks</div>
        </div>
      </div>

      <form
        className="panel mb-12"
        style={{ padding: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end' }}
        onSubmit={(e) => { e.preventDefault(); run(form); }}
      >
        <div>
          <label className="input-label" htmlFor="ac-email">Person (email)</label>
          <input id="ac-email" className="input mono" type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="user@example.com" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="input-label" htmlFor="ac-method">Method</label>
          <select id="ac-method" className="input mono" value={form.method} onChange={set('method')}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label" htmlFor="ac-path">Path</label>
          <input id="ac-path" className="input mono" placeholder="/api/clusters/42" value={form.path} onChange={set('path')} />
        </div>
        <div>
          <label className="input-label" htmlFor="ac-app">Site <span className="muted">(optional)</span></label>
          <select id="ac-app" className="input" value={form.app} onChange={set('app')}>
            <option value="">Work it out</option>
            {(services.data ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            {form.app && !(services.data ?? []).some((s) => s.name === form.app) && <option value={form.app}>{form.app}</option>}
          </select>
        </div>
        <button className="btn primary" type="submit" disabled={check.isPending}>{check.isPending ? 'Checking…' : 'Check'}</button>
        {problem && <div className="small" role="alert" style={{ color: 'var(--err)', gridColumn: '1 / -1' }}>{problem}</div>}
      </form>

      {check.isError && <CheckError error={check.error} onRetry={() => run(form)} />}
      {check.isSuccess && <Verdict r={check.data} />}
      {check.isIdle && !problem && (
        <div className="panel" style={{ padding: 40 }}><EmptyHint>Enter a person and a route to see whether they get in.</EmptyHint></div>
      )}
    </>
  );
}

function CheckError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const v = describeCheckError(error);
  return (
    <div role="alert" className="panel" style={{ padding: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ width: 16, height: 16, display: 'grid', placeItems: 'center', color: 'var(--err)', flexShrink: 0 }}>{I.alert}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500 }}>{v.title}</div>
        <div className="small muted" style={{ marginTop: 2 }}>{v.detail}</div>
      </div>
      {v.retryable && <button className="btn sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

function Chips({ items, none }: { items: string[]; none: string }) {
  if (items.length === 0) return <span className="small muted">{none}</span>;
  return <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{items.map((x) => <Chip key={x}>{x}</Chip>)}</span>;
}

function Verdict({ r }: { r: AccessCheckResult }) {
  const e = explain(r);
  const needs = requiredPermissions(r);
  return (
    <div className="panel" aria-live="polite">
      <div style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'flex-start', borderBottom: '1px solid var(--line)' }}>
        <Chip tone={r.allow ? 'ok' : 'err'}>{e.verdict}</Chip>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{e.text}</div>
          {e.tie && <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>Two sites claim this route: {r.owners.join(', ')}</div>}
        </div>
      </div>
      <table className="table">
        <tbody>
          <tr><th style={{ width: 180 }}>Owning site</th><td>{r.app ?? (r.owners.length ? r.owners.join(', ') : <span className="small muted">none</span>)}</td></tr>
          <tr>
            <th>Matching rule</th>
            <td>
              {r.matchingRules.length === 0
                ? <span className="small muted">no rule matches this route</span>
                : r.matchingRules.map((m, i) => (
                  <div key={i} className="mono small">{m.method} {m.path}{m.permission ? <> → <strong>{m.permission}</strong></> : ' → no permission needed'}</div>
                ))}
            </td>
          </tr>
          <tr><th>Required permission</th><td><Chips items={needs} none="none" /></td></tr>
          <tr><th>Their groups</th><td><Chips items={r.groups} none="no groups" /></td></tr>
          <tr><th>Their roles</th><td><Chips items={r.roles} none="no roles" /></td></tr>
          <tr><th>Their permissions</th><td>{r.superAdmin ? <Chip tone="accent">super admin · everything</Chip> : <Chips items={r.permissions} none="no permissions" />}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
