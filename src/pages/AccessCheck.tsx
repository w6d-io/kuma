import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useServices } from '../api/hooks';
import { orgAccessApi, type AccessCheckResult } from '../api/orgAccess';
import { METHODS, describeCheckError, explain, formFromQuery, requiredPermissions, validateCheck, type CheckForm } from '../lib/accessCheck';
import { formatHash, parseHash } from '../lib/route';
import { Badge, Button, Card, Callout, EmptyHint, Field, I, Input, PageHeader, Select, Table } from '../components/ui';

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
      <PageHeader title="Access checker" sub="Ask whether a person can call a route, and why — the same question the gateway asks" />

      <form
        className="panel mb-12 ac-form"
        onSubmit={(e) => { e.preventDefault(); run(form); }}
      >
        <Field label="Person (email)">
          <Input id="ac-email" mono type="text" inputMode="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="user@example.com" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Method">
          <Select id="ac-method" mono value={form.method} onChange={set('method')}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Path">
          <Input id="ac-path" mono placeholder="/api/clusters/42" value={form.path} onChange={set('path')} />
        </Field>
        <Field label={<>Site <span className="muted">(optional)</span></>}>
          <Select id="ac-app" value={form.app} onChange={set('app')}>
            <option value="">Work it out</option>
            {(services.data ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            {form.app && !(services.data ?? []).some((s) => s.name === form.app) && <option value={form.app}>{form.app}</option>}
          </Select>
        </Field>
        <Button variant="primary" type="submit" disabled={check.isPending}>{check.isPending ? 'Checking…' : 'Check'}</Button>
        {problem && <div className="small text-danger span-all" role="alert">{problem}</div>}
      </form>

      {check.isError && <CheckError error={check.error} onRetry={() => run(form)} />}
      {check.isSuccess && <Verdict r={check.data} />}
      {check.isIdle && !problem && (
        <Card pad="md" className="py-32"><EmptyHint>Enter a person and a route to see whether they get in.</EmptyHint></Card>
      )}
    </>
  );
}

function CheckError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const v = describeCheckError(error);
  return (
    <Callout
      tone="danger"
      icon={I.alert}
      title={v.title}
      actions={v.retryable && <Button size="sm" onClick={onRetry}>Retry</Button>}
    >
      <div className="small muted">{v.detail}</div>
    </Callout>
  );
}

function Chips({ items, none }: { items: string[]; none: string }) {
  if (items.length === 0) return <span className="small muted">{none}</span>;
  return <span className="row wrap gap-4">{items.map((x) => <Badge key={x}>{x}</Badge>)}</span>;
}

function Verdict({ r }: { r: AccessCheckResult }) {
  const e = explain(r);
  const needs = requiredPermissions(r);
  return (
    <Card aria-live="polite">
      <div className="row items-start gap-16 p-16 border-b">
        <Badge tone={r.allow ? 'success' : 'danger'}>{e.verdict}</Badge>
        <div className="flex-1 min-w-0">
          <div className="fw-medium">{e.text}</div>
          {e.tie && <div className="small text-warning mt-4">Two sites claim this route: {r.owners.join(', ')}</div>}
        </div>
      </div>
      <Table>
        <tbody>
          <tr><th className="ac-th">Owning site</th><td>{r.app ?? (r.owners.length ? r.owners.join(', ') : <span className="small muted">none</span>)}</td></tr>
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
          <tr><th>Their permissions</th><td>{r.superAdmin ? <Badge tone="accent">super admin · everything</Badge> : <Chips items={r.permissions} none="no permissions" />}</td></tr>
        </tbody>
      </Table>
    </Card>
  );
}
