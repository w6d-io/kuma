import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, type LookupHit } from '../api/client';
import { useServices } from '../api/hooks';
import { orgAccessApi, type AccessCheckResult } from '../api/orgAccess';
import { METHODS, describeCheckError, explain, formFromQuery, requiredPermissions, validateCheck, type CheckForm } from '../lib/accessCheck';
import { linkedPerson } from '../lib/personFind';
import { formatHash, parseHash } from '../lib/route';
import { PersonBadges, PersonFinder } from '../components/PersonFinder';
import { Avatar, Badge, Button, Callout, Card, EmptyHint, Field, FieldRow, I, Input, PageHeader, Select, Table } from '../components/ui';

/** The form a link describes, with the person it names (`?user=<id|email>` or the older `?email=`). */
function formFromLink(): { form: CheckForm; id: string | null } {
  const query = parseHash(window.location.hash).query;
  const person = linkedPerson(query);
  return { form: { ...formFromQuery(query), email: person.email }, id: person.id };
}

/**
 * "Why can't X do Y?" — asks the engine the same question the gateway asks, for somebody else, and
 * says the answer in words. The form is the address (`#/access-check?user=<id|email>&method=…&path=…`),
 * so a check can be pasted into a ticket and reopened as it was. The person is found as you type —
 * by address, the start of one, or a pasted Kratos id — and loaded with one click.
 */
export function AccessCheckPage() {
  const [form, setForm] = useState<CheckForm>(() => formFromLink().form);
  const [person, setPerson] = useState<LookupHit | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const services = useServices();
  const check = useMutation({ mutationFn: (f: CheckForm) => orgAccessApi.accessCheck(f) });
  // The address last acted on. The same one arriving twice (mount, then the hashchange that brought
  // us here) is one link; the one this page writes back is already on screen.
  const handled = useRef<string | null>(null);

  const run = (f: CheckForm, who: LookupHit | null = person) => {
    const bad = validateCheck(f);
    setProblem(bad);
    if (bad) return;
    // Rewrite the address without a navigation, so the check is shareable and Back still leaves. The
    // id when the person was found, because it survives a change of address.
    const { email, ...rest } = f;
    const user = who && who.email === email ? who.id : email;
    handled.current = `#${formatHash('accesscheck', null, { user, ...rest })}`;
    history.replaceState(null, '', handled.current);
    check.mutate(f);
  };

  const pick = (h: LookupHit) => {
    setPerson(h);
    const next = { ...form, email: h.email };
    setForm(next);
    // One click: with a route already there, the check runs for them straight away.
    if (next.path.trim()) run(next, h);
    else setProblem(null);
  };

  // A link that arrives complete runs at once; a pasted one while the page is open does too. A link
  // naming an id is looked up first; one naming an address is looked up only to show who it is.
  useEffect(() => {
    let current = true;
    const fromLink = () => {
      if (window.location.hash === handled.current) return;
      handled.current = window.location.hash;
      const { form: f, id } = formFromLink();
      setForm(f);
      setPerson(null);
      const term = id ?? (f.email || null);
      if (!term) return;
      if (!id && f.path && !validateCheck(f)) check.mutate(f);
      api.lookupUsers(term, 1).then((a) => {
        const hit = a.data[0];
        if (!current || !hit || (!id && hit.email.toLowerCase() !== f.email.trim().toLowerCase())) return;
        setPerson(hit);
        if (id) {
          const resolved = { ...f, email: hit.email };
          setForm(resolved);
          if (resolved.path && !validateCheck(resolved)) check.mutate(resolved);
        }
      }, () => {
        if (current && id) setProblem('Nobody with that Kratos id could be looked up.');
      });
    };
    fromLink();
    window.addEventListener('hashchange', fromLink);
    return () => { current = false; window.removeEventListener('hashchange', fromLink); };
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
        <FieldRow>
        <Field label="Person (email or Kratos id)" span={2}>
          <PersonFinder
            id="ac-email"
            value={form.email}
            onChange={(email) => {
              setForm((f) => ({ ...f, email }));
              if (person && person.email !== email) setPerson(null);
            }}
            onPick={pick}
          />
        </Field>
        <Field label="Method">
          <Select id="ac-method" mono value={form.method} onChange={set('method')}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Path" span={2}>
          <Input id="ac-path" mono placeholder="/api/clusters/42" value={form.path} onChange={set('path')} />
        </Field>
        <Field label={<>Site <span className="muted">(optional)</span></>} span={2}>
          <Select id="ac-app" value={form.app} onChange={set('app')}>
            <option value="">Work it out</option>
            {(services.data ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            {form.app && !(services.data ?? []).some((s) => s.name === form.app) && <option value={form.app}>{form.app}</option>}
          </Select>
        </Field>
        <Button variant="primary" type="submit" disabled={check.isPending}>{check.isPending ? 'Checking…' : 'Check'}</Button>
        </FieldRow>
        {problem && <div className="small text-danger" role="alert">{problem}</div>}
      </form>

      {person && <PersonCard hit={person} />}
      {check.isError && <CheckError error={check.error} onRetry={() => run(form)} />}
      {check.isSuccess && <Verdict r={check.data} />}
      {check.isIdle && !problem && (
        <Card pad="md" className="py-32"><EmptyHint>Enter a person and a route to see whether they get in.</EmptyHint></Card>
      )}
    </>
  );
}

/** Who the check is about: the person as the directory knows them, so the answer is read against them. */
function PersonCard({ hit }: { hit: LookupHit }) {
  const orgs = hit.organizations;
  return (
    <Card pad="md" className="mb-12 ac-person" aria-label="Person being checked">
      <div className="row wrap gap-12">
        <Avatar name={hit.name ?? undefined} email={hit.email} size={32} />
        <div className="flex-1 min-w-0">
          <div className="fw-medium">{hit.name ?? hit.email}</div>
          <div className="small muted mono">{hit.email} · <span title="Kratos identity id">{hit.id}</span></div>
        </div>
        <PersonBadges hit={hit} />
        <Button size="sm" variant="ghost" icon={I.arrowOut} onClick={() => { window.location.hash = formatHash('users', hit.id); }}>Open</Button>
      </div>
      <div className="small muted mt-8">
        {orgs === null ? 'Organisations could not be read.' : orgs.length === 0 ? 'In no organisation.' : `Organisations: ${orgs.join(', ')}`}
      </div>
    </Card>
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
        <Badge tone={r.allow ? 'success' : 'danger'} icon={r.allow ? I.check : I.close} className="verdict">{e.verdict}</Badge>
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
