import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, ButtonBase, Callout, EmptyRow, EmptyState, I, Input, LoadingRows, PageHeader, Table, Th } from '../../components/ui';
import { ApiErrorState } from '../../components/ApiErrorState';
import { notAvailable, sitesApi, useHosts } from '../../api/sites';
import { goSites, sitesHref } from '../../lib/sites/route';
import { filterHosts, hostAccess, hostFlags } from '../../lib/sites/hosts';
import type { HostEntry } from '../../lib/sites/types';
import { useSitePerms } from './usePerms';
import { DeletionsWaiting } from './Deletions';
import { MigrationCallout } from './SitesList';
import { SitesViewSwitch } from './SitesViewSwitch';

/**
 * The Sites page, by address (Sites redesign, phase 1): one row per host — how many services it
 * carries, who may reach them at a glance, what waits — and a click opens the host with every service
 * on it. Nothing is merged: "All sites" keeps the flat list of every site, one per row.
 */

function AccessAtGlance({ h }: { h: HostEntry }) {
  const a = hostAccess(h.services);
  return (
    <span className="row gap-4 wrap">
      {a.public > 0 && <Badge tone="danger" mono={false}>{a.public} public</Badge>}
      {a.signedIn > 0 && <Badge tone="warning" mono={false}>{a.signedIn} signed in</Badge>}
      {a.permission > 0 && <Badge tone="info" mono={false}>{a.permission} permission</Badge>}
      {a.orgKeys > 0 && <Badge tone="accent" mono={false}>{a.orgKeys} org keys</Badge>}
    </span>
  );
}

function Flags({ h }: { h: HostEntry }) {
  const flags = hostFlags(h);
  if (flags.length === 0) return <Badge tone="success" mono={false} icon={I.check}>{h.counts.live === h.counts.services ? 'All live' : `${h.counts.live} live`}</Badge>;
  return <span className="row gap-4 wrap">{flags.map((f) => <Badge key={f} tone="warning" mono={false}>{f}</Badge>)}</span>;
}

export function AddressList({ query }: { query: Record<string, string> }) {
  const perms = useSitePerms();
  const hosts = useHosts();
  const migration = useQuery({ queryKey: ['sites', 'migration'], queryFn: () => sitesApi.migration(), retry: false, enabled: perms.canApply });
  const [search, setSearch] = useState(query.q ?? '');
  const shown = filterHosts(hosts.data ?? [], search);
  const open = (h: HostEntry) => goSites(sitesHref({ view: 'host', host: h.host }));
  const plug = perms.canDraft && (
    <Button variant="primary" icon={I.plus} kbd="n" onClick={() => goSites(sitesHref({ view: 'new' }))}>Plug a site</Button>
  );
  const services = (h: HostEntry) => `${h.counts.services} service${h.counts.services === 1 ? '' : 's'}`;

  return (
    <div className="page-enter">
      <PageHeader
        title="Sites"
        sub="Every address people reach through the platform, and the services mounted on it: where each path goes and who gets in."
        actions={plug}
      />
      {!perms.canDraft && perms.canRead && (
        <Callout tone="info" icon={I.info} className="mb-12">You can look around. Changing sites needs a platform admin.</Callout>
      )}
      <DeletionsWaiting />
      <MigrationCallout migration={migration.data} />

      <div className="site-toolbar">
        <SitesViewSwitch value="address" />
        <Input size="sm" leading={I.search} placeholder="Search an address, a path, a backend or a site" aria-label="Search addresses" value={search} onChange={(e) => setSearch(e.target.value)} className="site-search" />
      </div>

      {notAvailable(hosts.error) ? (
        <EmptyState icon={I.clock} title="Sites by address need a newer jinbe" action={<Button onClick={() => goSites(sitesHref({ view: 'list', query: { show: 'all' } }))}>Show all sites</Button>}>
          This server has no /api/admin/sites/hosts yet. The flat list of every site still works.
        </EmptyState>
      ) : hosts.error ? (
        <ApiErrorState error={hosts.error} what="the sites" onRetry={() => void hosts.refetch()} />
      ) : !hosts.isLoading && (hosts.data ?? []).length === 0 ? (
        <EmptyState icon={I.globe} title="Put your first site behind sign-in" action={plug || undefined}>
          Give it an address and tell us where it runs. We create the gateway rule, the permissions and the web address — usually in under a minute.
        </EmptyState>
      ) : (
        <>
          <Table className="site-table" aria-label="Addresses">
            <thead><tr><Th>Address</Th><Th>Services</Th><Th>Who gets in</Th><Th>State</Th></tr></thead>
            <tbody>
              {hosts.isLoading && <LoadingRows cols={4} rows={4} />}
              {!hosts.isLoading && shown.length === 0 && <EmptyRow colSpan={4}>No address, path, backend or site matches.</EmptyRow>}
              {shown.map((h) => (
                <tr key={h.host}>
                  <td>
                    <ButtonBase className="site-row-name" onClick={() => open(h)}>
                      <span className="fw-medium mono">{h.host}</span>
                    </ButtonBase>
                    {h.zone && <div className="small muted">in {h.zone}</div>}
                  </td>
                  <td className="small">{services(h)}</td>
                  <td><AccessAtGlance h={h} /></td>
                  <td><Flags h={h} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
          <ul className="site-cards" aria-label="Addresses">
            {shown.map((h) => (
              <li key={h.host}>
                <ButtonBase className="site-card" onClick={() => open(h)}>
                  <span className="mono fw-medium break-all">{h.host}</span>
                  <span className="small muted">{services(h)}</span>
                  <AccessAtGlance h={h} />
                  <Flags h={h} />
                </ButtonBase>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
