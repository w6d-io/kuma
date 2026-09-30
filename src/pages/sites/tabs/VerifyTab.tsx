import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, CopyField, EmptyState, Field, I, RelativeTime, Switch, Table, Th } from '../../../components/ui';
import { sitesApi, type SiteError } from '../../../api/sites';
import { ANSWER_WORD, EXPECT_WORD, ROLLOUT_LEVEL, type ProbeResult, type VerifyReport } from '../../../lib/sites/verify';
import { accessWord } from '../../../lib/sites/format';
import type { SiteEditor } from '../useSiteEditor';
import type { Go } from '../SiteDetail';
import { CheckList } from '../parts';
import { describeSiteError } from '../useAction';

/**
 * Verify (jinbe POST /sites/:name/verify): is what was published really live, and does it keep out
 * who it should? The rollout checklist, one anonymous request per route (a protected route that
 * answers 2xx is a security error), the policy engine's answer per route and subject, and curl lines
 * to see it by hand. Run on demand: it calls every route and the server allows one run per 30 s.
 */

const LEVEL_TONE: Record<ProbeResult['level'], 'success' | 'danger' | 'warning'> = { ok: 'success', error: 'danger', warn: 'warning' };
const VERDICT_WORD: Record<ProbeResult['verdict'], string> = { ok: 'As expected', exposed: 'Exposed', unexpected: 'Unexpected', unreachable: 'Unreachable', skipped: 'Skipped' };

export function VerifyTab({ ed, go }: { ed: SiteEditor; go: Go }) {
  const [waf, setWaf] = useState(false);
  const q = useQuery({
    queryKey: ['sites', 'verify', ed.name],
    queryFn: () => sitesApi.verify(ed.name, { waf }),
    enabled: false, retry: false, staleTime: Infinity,
  });
  const report = q.data;
  const applied = ed.detail.data?.applied;

  return (
    <div className="stack gap-16">
      <Card
        title="Verify what is live"
        sub="Checks the rollout, calls every route without signing in, asks the policy engine who may pass, and gives curl lines to try it yourself."
        actions={<Button variant="primary" icon={I.shield} loading={q.isFetching} onClick={() => void q.refetch()}>{report ? 'Run again' : 'Run verification'}</Button>}
      >
        <Field label="Also test the web firewall" inline hint="Sends one request the WAF should block.">
          <Switch on={waf} label="Test the web firewall" onChange={setWaf} />
        </Field>
        {!applied && <p className="small muted mt-8 mb-0">Nothing is published for this site yet: only the rollout can be checked.</p>}
      </Card>

      {q.isFetching && <CheckList lines={[{ level: 'pending', text: 'Calling every route and asking the policy engine… this can take up to a minute.' }]} />}
      {q.error && !q.isFetching && <VerifyError error={q.error} />}
      {!report && !q.isFetching && !q.error && (
        <EmptyState icon={I.shield} title="Not verified yet">Run it after every publish: it shows what an anonymous visitor really gets.</EmptyState>
      )}
      {report && <Report report={report} go={go} />}
    </div>
  );
}

function VerifyError({ error }: { error: unknown }) {
  const e = error as SiteError & { retryAfter?: number };
  if (e.code === 'verify_rate_limited') {
    return <Callout tone="warning" icon={I.clock}>Verified a moment ago. Try again in {e.retryAfter ?? 30} s.</Callout>;
  }
  return <Callout tone="danger" icon={I.alert}>{describeSiteError(error)}</Callout>;
}

function Report({ report: r, go }: { report: VerifyReport; go: Go }) {
  const exposed = r.probe.results.filter((p) => p.verdict === 'exposed');
  return (
    <>
      <Callout
        tone={r.summary.errors.length ? 'danger' : r.summary.warnings.length ? 'warning' : 'success'}
        icon={r.summary.errors.length || r.summary.warnings.length ? I.alert : I.check}
        title={r.summary.ok ? 'Live and answering as configured' : `${r.summary.errors.length} problem${r.summary.errors.length === 1 ? '' : 's'} found`}
        actions={exposed.length > 0 && <Button size="sm" variant="primary" onClick={() => go('routes')}>Fix routes</Button>}
      >
        <div className="small">
          <p className="m-0 muted">
            {r.host} · {r.version.applied != null ? `v${r.version.applied} live` : 'nothing live'}{r.version.saved !== r.version.applied ? ` · v${r.version.saved} saved` : ''} · checked <RelativeTime at={r.checkedAt} />
          </p>
          {(r.summary.errors.length > 0 || r.summary.warnings.length > 0) && (
            <ul className="site-list mt-8 mb-0">
              {r.summary.errors.map((t, i) => <li key={`e${i}`}>{t}</li>)}
              {r.summary.warnings.map((t, i) => <li key={`w${i}`} className="muted">{t}</li>)}
            </ul>
          )}
        </div>
      </Callout>

      <Card title="Rollout" sub={r.rollout.ready ? 'Ready' : 'Not ready yet'}>
        <CheckList live={false} lines={r.rollout.checks.map((c) => ({ level: ROLLOUT_LEVEL[c.status], text: `${c.label}: ${c.message}` }))} />
        {r.waf && <CheckList live={false} className="mt-8" lines={[{ level: !r.waf.checked ? 'info' : r.waf.blocked ? 'ok' : 'error', text: `Web firewall: ${r.waf.message}` }]} />}
      </Card>

      <Card title="Anonymous requests" sub="What somebody who is not signed in gets from each route.">
        {!r.probe.available
          ? <Callout tone="info" icon={I.info}>{r.probe.reason ?? 'The server could not call the site.'} Use the curl lines below to check by hand.</Callout>
          : (
            <Table aria-label="Anonymous requests">
              <thead><tr><Th scope="col">Request</Th><Th scope="col">Expected</Th><Th scope="col">Answer</Th><Th scope="col">Result</Th></tr></thead>
              <tbody>
                {r.probe.results.map((p, i) => (
                  <tr key={i}>
                    <td><span className="mono small">{p.method} {p.url}</span><div className="small muted">{p.route === 'catch-all' ? 'Everything else' : p.route}</div></td>
                    <td className="small">{EXPECT_WORD[p.expect]}</td>
                    <td className="mono small">{p.status ?? '—'}{p.location ? ` → ${p.location}` : ''}</td>
                    <td><Badge tone={LEVEL_TONE[p.level]} mono={false}>{VERDICT_WORD[p.verdict]}</Badge><div className="small">{p.message}</div></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        {r.probe.notProbed.length > 0 && <p className="small muted mt-8 mb-0">Not called: {r.probe.notProbed.join(', ')}.</p>}
      </Card>

      <Card title="Who may pass" sub="The policy engine’s answer for each route and each group or role.">
        {!r.access.available
          ? <Callout tone="info" icon={I.info}>{r.access.reason ?? 'The policy engine could not be asked.'}</Callout>
          : (
            <Table className="site-matrix" aria-label="Access matrix">
              <thead>
                <tr><Th scope="col">Route</Th>{r.access.subjects.map((s) => <Th key={s.key} scope="col" align="center" className="small">{s.name}</Th>)}</tr>
              </thead>
              <tbody>
                {r.access.rows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row"><span className="mono small">{row.method} {row.path}</span><div className="small muted">{accessWord(accessOf(row.access))}</div></th>
                    {r.access.subjects.map((s) => {
                      const a = ANSWER_WORD[row.answers[s.key] ?? 'unknown'];
                      return <td key={s.key} className="align-center"><Badge tone={a.tone} mono={false}>{a.text}</Badge></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        {r.access.notChecked.length > 0 && <p className="small muted mt-8 mb-0">Not checked: {r.access.notChecked.join(', ')}.</p>}
      </Card>

      {r.curl.length > 0 && (
        <Card title="Try it yourself" sub="Without signing in, then with a token: set TOKEN first (export TOKEN=…).">
          <div className="stack gap-12">
            {r.curl.map((c, i) => (
              <div key={i} className="stack gap-4">
                <span className="small"><span className="mono">{c.method} {c.url}</span>{c.route === 'catch-all' ? ' · everything else' : ''}</span>
                <CopyField size="sm" label={`${c.method} ${c.url} without signing in`} value={c.anonymous} />
                <CopyField size="sm" label={`${c.method} ${c.url} with a token`} value={c.withToken} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

/** The report's access word back into the site's own terms, for the shared wording. */
function accessOf(access: string) {
  if (access === 'public' || access === 'signed-in' || access === 'deny') return { kind: access } as const;
  return { kind: 'permission', permission: access } as const;
}
