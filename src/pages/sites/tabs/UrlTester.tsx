import { useEffect, useState } from 'react';
import { Button, Card, I, Input, Segmented, Select } from '../../../components/ui';
import { sitesApi, notAvailable, type SiteError } from '../../../api/sites';
import { displayPath, matchesPath } from '../../../lib/sites/paths';
import { HTTP_METHODS, type HttpMethod, type MatchResult, type Site } from '../../../lib/sites/types';
import { parseTest, upstreamRequest } from '../../../lib/sites/tester';
import { CheckList, type CheckLine } from '../parts';

/**
 * Test a URL (site-ux.md §6.2): which gateway rule catches it (gatekit, against the live rules plus
 * this draft), which route answers, what it needs, and what the service receives. The input is in
 * the address (`?test=GET /api/x`) so a result can be pasted into a ticket.
 */

export function UrlTester({ site, initial, onChange, hasDraft }: {
  site: Site;
  initial?: string;
  onChange?: (test: string) => void;
  hasDraft: boolean;
}) {
  const start = parseTest(initial);
  const [method, setMethod] = useState<HttpMethod>(start.method);
  const [path, setPath] = useState(start.path);
  const [against, setAgainst] = useState<'draft' | 'live'>(hasDraft ? 'draft' : 'live');
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const host = site.address.host;

  async function run(m = method, p = path) {
    setBusy(true);
    setError(null);
    onChange?.(`${m} ${p}`);
    try {
      const out = await sitesApi.match({ method: m, url: `https://${host}${p}`, against, ...(against === 'draft' ? { site } : {}) });
      setResult(out);
    } catch (err) {
      setResult(null);
      const e = err as SiteError;
      setError(notAvailable(err) ? 'The tester is not available on this server yet.' : e.status === 503 ? 'Checks are unavailable (gatekit did not answer).' : e.message);
    } finally {
      setBusy(false);
    }
  }

  // A link with ?test= runs once on arrival.
  useEffect(() => { if (initial) void run(start.method, start.path); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lines: CheckLine[] = [];
  if (result) {
    const v = result.gateway.verdict;
    lines.push(v === 'one'
      ? { level: 'ok', text: <>Gateway: <span className="mono">{result.gateway.rules[0]}</span> catches it</> }
      : v === 'none'
        ? { level: 'error', text: 'Gateway: no rule matches → 404 for everyone.' }
        : v === 'multiple'
          ? { level: 'error', text: <>Gateway: two rules match (<span className="mono">{result.gateway.rules.join(', ')}</span>) → the gateway answers 500 for this URL.</> }
          : { level: 'error', text: `Gateway: a rule failed to compile — ${result.gateway.errors?.map((x) => x.error).join('; ') ?? 'unknown'}` });
    if (result.route) {
      const row = site.routes.items.findIndex((r) => r.methods.includes(method) && r.path === result.route!.path);
      lines.push({ level: 'info', text: <>Route: {row >= 0 ? `#${row + 1} ` : 'everything else '}<span className="mono">{result.route.method} {displayPath(result.route.path)}</span> (exact beats :param beats *)</> });
    }
    lines.push({ level: result.needs.startsWith('no route') ? 'warn' : 'info', text: <>Needs: <b>{result.needs}</b>{result.org ? <> · in org <span className="mono">{result.org}</span> (from the URL)</> : null}</> });
    if (result.site && result.site !== site.name) lines.push({ level: 'warn', text: `This URL is answered by another site: ${result.site}.` });
    lines.push({ level: 'info', text: <>Upstream receives: <span className="mono break-all">{method} {upstreamRequest(site, path)}</span></> });
  } else if (!error) {
    // Instant, local: which route row this would hit, before asking the gateway.
    const local = site.routes.items.find((r) => r.methods.includes(method) && matchesPath(r.path, path));
    lines.push({ level: 'info', text: local ? <>Probably route <span className="mono">{displayPath(local.path)}</span>. Press Test for the gateway’s answer.</> : 'Paste any URL of this site to see which route and gate handle it, and who gets in.' });
  }

  const checker = `#/access-check?app=${encodeURIComponent(site.name)}&method=${method}&path=${encodeURIComponent(path)}`;

  return (
    <Card title="Test a URL" sub={`against ${against === 'draft' ? 'this draft + the live rules' : 'what’s live now'}`} actions={hasDraft && (
      <Segmented label="Test against" value={against} onChange={setAgainst} options={[{ value: 'draft', label: 'Draft' }, { value: 'live', label: 'Live' }]} />
    )}>
      <form className="site-tester" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Select size="sm" aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} className="mono">
          {HTTP_METHODS.map((m) => <option key={m}>{m}</option>)}
        </Select>
        <span className="mono small muted site-tester-host">{host}</span>
        <Input
          size="sm"
          mono
          aria-label="Path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            try {
              const u = new URL(text);
              if (u.hostname === host) { e.preventDefault(); setPath(u.pathname + u.search); }
            } catch { /* a path, not a URL */ }
          }}
        />
        <Button size="sm" type="submit" variant="primary" loading={busy}>Test</Button>
      </form>
      {error && <CheckList lines={[{ level: 'error', text: error }]} />}
      <CheckList lines={lines} />
      <p className="small mb-0 mt-8"><a href={checker}>Check a person in the Access checker {I.arrowOut}</a></p>
    </Card>
  );
}
