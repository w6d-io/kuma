import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../api/client';
import { Badge, Button, Card, CopyField, EmptyRow, Field, I, Input, LoadingRows, Table } from '../../components/ui';
import type { PushToast } from './toastErr';

/**
 * An organization's email domains (jinbe sites/signup): once a domain is proven with a DNS TXT record,
 * people who sign up with that domain on a site that joins by domain land in this organization. Claim,
 * publish the record, verify, release.
 */

interface DomainClaim {
  domain: string;
  verified: boolean;
  claimedAt: string;
  verifiedAt: string | null;
  record?: { name: string; type: 'TXT'; value: string };
}

const base = (org: string) => `/organizations/${encodeURIComponent(org)}/domains`;

export function OrgDomains({ org, mayManage, pushToast }: { org: string; mayManage: boolean; pushToast: PushToast }) {
  const qc = useQueryClient();
  const key = ['org-domains', org];
  const q = useQuery({ queryKey: key, queryFn: () => request<{ domains: DomainClaim[] }>(base(org)).then((r) => r.domains) });
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      pushToast(ok);
      await refresh();
    } catch (e: unknown) {
      pushToast((e as Error).message || 'That did not work', { err: true });
    } finally {
      setBusy(null);
    }
  }

  const claim = () => act('claim', () => request(base(org), { method: 'POST', body: JSON.stringify({ domain: domain.trim().toLowerCase() }) }).then(() => setDomain('')), 'Domain claimed: publish the DNS record, then verify');
  const verify = (d: string) => act(d, () => request(`${base(org)}/${encodeURIComponent(d)}/verify`, { method: 'POST' }), `${d} verified`);
  const release = (d: string) => act(d, () => request(`${base(org)}/${encodeURIComponent(d)}`, { method: 'DELETE' }), `${d} released`);

  return (
    <Card title="Email domains" sub="People who sign up with a verified domain, on a site that joins by domain, land in this organization." pad="none">
      <Table>
        <thead><tr><th>Domain</th><th>State</th><th>DNS record to publish</th><th className="actions" /></tr></thead>
        <tbody>
          {q.isLoading && <LoadingRows rows={2} cols={4} />}
          {q.isError && <EmptyRow colSpan={4}>Could not load the domains.</EmptyRow>}
          {q.data && q.data.length === 0 && <EmptyRow colSpan={4}>No domain claimed.</EmptyRow>}
          {q.data?.map((c) => (
            <tr key={c.domain}>
              <td className="mono">{c.domain}</td>
              <td>{c.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Waiting for DNS</Badge>}</td>
              <td className="small">{c.record ? <><span className="mono">{c.record.type} {c.record.name}</span><CopyField value={c.record.value} /></> : '—'}</td>
              <td className="actions">
                {mayManage && !c.verified && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => verify(c.domain)}>Verify</Button>}
                {mayManage && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => release(c.domain)}>Release</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {mayManage && (
        <div className="row gap-8 p-12">
          <Field label="Claim a domain" hint="Like client.com: you then publish a TXT record to prove it is yours">
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="client.com" />
          </Field>
          <Button icon={I.plus} disabled={!domain.trim() || busy !== null} onClick={claim}>Claim</Button>
        </div>
      )}
    </Card>
  );
}
