import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, ButtonBase, Callout, EmptyRow, EmptyState, I, Input, LoadingRows, PageHeader, Segmented, Table, Th } from '../../components/ui';
import { sitesApi, useSites, notAvailable } from '../../api/sites';
import { goSites, sitesHref } from '../../lib/sites/route';
import type { SiteSummary } from '../../lib/sites/types';
import { QueryError, StatusBadge } from './parts';
import { timeAgo } from '../../lib/sites/format';
import { useSitePerms } from './usePerms';

/**
 * The Sites list (site-ux.md §5.1): every site with its state in words, the built-in system sites
 * read-only at the bottom, filters that are links, and the way in for somebody with none yet.
 */

type Filter = 'all' | 'attention' | 'paused' | 'drafts';

const FILTERS: Record<Filter, (s: SiteSummary) => boolean> = {
  all: () => true,
  attention: (s) => s.status === 'attention' || (s.attention?.length ?? 0) > 0,
  paused: (s) => s.status === 'paused',
  drafts: (s) => s.status === 'draft' || !!s.draft,
};

function subline(s: SiteSummary): string {
  if (s.system) return 'Managed by the platform chart · read-only';
  if (s.attention?.length) return s.attention[0];
  if (s.draft) return `Draft · unapplied changes by ${s.draft.by}${s.draft.at ? ` · ${timeAgo(s.draft.at)}` : ''}`;
  if (s.status === 'attention') return `v${s.version} saved, v${s.appliedVersion ?? '—'} live — review and apply`;
  if (s.appliedAt) return `v${s.appliedVersion ?? s.version} · applied ${timeAgo(s.appliedAt)}${s.appliedBy ? ` by ${s.appliedBy}` : ''}`;
  return 'Never applied';
}

export function SitesList({ query }: { query: Record<string, string> }) {
  const perms = useSitePerms();
  const sites = useSites();
  // System sites (§20.1) — served once the operator renders them; absent before.
  const system = useQuery({ queryKey: ['sites', 'list', 'system'], queryFn: () => sitesApi.list({ system: true }), retry: false });
  const migration = useQuery({ queryKey: ['sites', 'migration'], queryFn: () => sitesApi.migration(), retry: false, enabled: perms.canApply });
  const [search, setSearch] = useState(query.q ?? '');
  const filter: Filter = (['all', 'attention', 'paused', 'drafts'] as const).find((f) => f === query.filter) ?? 'all';

  const all = useMemo(() => {
    const own = sites.data ?? [];
    const sys = (system.data ?? []).filter((s) => s.system && !own.some((o) => o.name === s.name));
    return [...own, ...sys.map((s) => ({ ...s, status: 'platform' as const }))];
  }, [sites.data, system.data]);
  const needle = search.trim().toLowerCase();
  const shown = all
    .filter(FILTERS[filter])
    .filter((s) => !needle || s.name.includes(needle) || s.displayName.toLowerCase().includes(needle) || s.host.includes(needle));
  const count = (f: Filter) => all.filter(FILTERS[f]).length;
  const open = (s: SiteSummary) => goSites(sitesHref({ view: 'site', name: s.name, tab: s.draft && !s.system ? 'review' : undefined }));
  const migrating = migration.data && !['done', 'cut-over'].includes(migration.data.state);

  const plug = perms.canDraft && (
    <Button variant="primary" icon={I.plus} kbd="n" onClick={() => goSites(sitesHref({ view: 'new' }))}>Plug a site</Button>
  );

  return (
    <div className="page-enter">
      <PageHeader
        title="Sites"
        sub="Websites, apps and APIs people reach through the platform: their address, who gets in, and what the gateway does."
        actions={plug}
      />
      {!perms.canDraft && perms.canRead && (
        <Callout tone="info" icon={I.info} className="mb-12">You can look around. Changing sites needs a platform admin.</Callout>
      )}
      {migrating && (
        <Callout
          tone="warning"
          icon={I.sync}
          className="mb-12"
          title="The gateway still reads rules from the old source"
          actions={<Button size="sm" onClick={() => goSites(sitesHref({ view: 'migrate' }))}>Start migration</Button>}
        >
          {migration.data!.legacyRules} legacy rules. Move them to sites — preview first, nothing changes until you cut over. New sites can be applied only after the cut-over.
        </Callout>
      )}

      <div className="site-toolbar">
        <Segmented
          label="Filter sites"
          value={filter}
          onChange={(f) => goSites(sitesHref({ view: 'list', query: { filter: f === 'all' ? undefined : f, q: search || undefined } }))}
          options={[
            { value: 'all', label: 'All', count: count('all') },
            { value: 'attention', label: 'Needs attention', count: count('attention') },
            { value: 'paused', label: 'Paused', count: count('paused') },
            { value: 'drafts', label: 'Drafts', count: count('drafts') },
          ]}
        />
        <Input size="sm" leading={I.search} placeholder="Search sites" aria-label="Search sites" value={search} onChange={(e) => setSearch(e.target.value)} className="site-search" />
      </div>

      {sites.error && !notAvailable(sites.error) ? <QueryError error={sites.error} what="sites" /> : null}
      {notAvailable(sites.error) ? (
        <EmptyState icon={I.clock} title="Sites are not available on this server yet">Update jinbe to a version with /api/admin/sites.</EmptyState>
      ) : !sites.isLoading && all.length === 0 ? (
        <EmptyState
          icon={I.globe}
          title="Put your first site behind sign-in"
          action={plug || undefined}
        >
          Give it an address and tell us where it runs. We create the gateway rule, the permissions and the web address — usually in under a minute.
        </EmptyState>
      ) : (
        <>
          <Table className="site-table" aria-label="Sites">
            <thead>
              <tr><Th>Site</Th><Th>Address</Th><Th>Kind</Th><Th>State</Th><Th>Version</Th></tr>
            </thead>
            <tbody>
              {sites.isLoading && <LoadingRows cols={5} rows={4} />}
              {!sites.isLoading && shown.length === 0 && (
                <EmptyRow colSpan={5}>{filter === 'drafts' ? 'No unapplied changes. Everything you see is live.' : 'No site matches.'}</EmptyRow>
              )}
              {shown.map((s) => (
                <tr key={s.name}>
                  <td>
                    <ButtonBase className="site-row-name" onClick={() => open(s)}>
                      {s.system && <span className="icon" aria-hidden="true">{I.lock}</span>}
                      <span className="fw-medium">{s.displayName}</span>
                      <span className="muted mono small">{s.name}</span>
                    </ButtonBase>
                    <div className="small muted">{subline(s)}</div>
                  </td>
                  <td className="mono small">{s.host}</td>
                  <td className="small">{s.system ? 'System site' : s.kind ?? '—'}</td>
                  <td><StatusBadge status={s.status} />{s.draft && s.status !== 'draft' && <Badge tone="plain" mono={false} icon={I.edit}>draft</Badge>}</td>
                  <td className="small tabular">{s.status === 'draft' && !s.appliedVersion ? 'draft' : `v${s.appliedVersion ?? s.version}`}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <ul className="site-cards" aria-label="Sites">
            {shown.map((s) => (
              <li key={s.name}>
                <ButtonBase className="site-card" onClick={() => open(s)}>
                  <span className="row gap-8 items-baseline"><span className="fw-medium">{s.displayName}</span><StatusBadge status={s.status} /></span>
                  <span className="mono small">{s.host}</span>
                  <span className="small muted">{subline(s)}</span>
                </ButtonBase>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
