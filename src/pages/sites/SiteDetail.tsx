import { useEffect } from 'react';
import { Badge, Button, Callout, EmptyState, I, PageHeader, SkeletonPanel, Tabs } from '../../components/ui';
import { goSites, sitesHref, type SiteTab } from '../../lib/sites/route';
import { useSiteEditor } from './useSiteEditor';
import { QueryError, StatusBadge } from './parts';
import { timeAgo } from '../../lib/sites/format';
import { useSitePerms } from './usePerms';
import { OverviewTab } from './tabs/OverviewTab';
import { RoutesTab } from './tabs/RoutesTab';
import { GatesTab } from './tabs/GatesTab';
import { AccessTab } from './tabs/AccessTab';
import { LoginTab } from './tabs/LoginTab';
import { StatusTab } from './tabs/StatusTab';
import { HistoryTab } from './tabs/HistoryTab';
import { SettingsTab } from './tabs/SettingsTab';
import { ReviewTab } from './tabs/ReviewTab';
import { PendingRequests } from './PendingRequests';
import { useInvalidateSite } from '../../api/sites';

/**
 * One site (site-ux.md §5.2): who it is, whether there is a draft, and its tabs. The draft banner is
 * on every tab — "visitors still see version 7" — so nobody mistakes an edit for a live change.
 */
export function SiteDetailPage({ name, tab, query }: { name: string; tab: SiteTab; query: Record<string, string> }) {
  const ed = useSiteEditor(name);
  const perms = useSitePerms();
  const readOnly = ed.system || !perms.canDraft;
  const invalidate = useInvalidateSite();
  const go = (t: SiteTab, q?: Record<string, string | undefined>) => goSites(sitesHref({ view: 'site', name, tab: t, query: q }));

  // ⌘↵ / Ctrl↵ opens Review (§10.8); ⌘S saves the draft now.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'Enter' && ed.hasDraft && !readOnly) { e.preventDefault(); go('review'); }
      if (e.key === 's' && !readOnly) { e.preventDefault(); void ed.saveNow(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  if (ed.loading) return <div className="page-enter"><SkeletonPanel lines={6} /></div>;
  if (ed.missing) {
    return (
      <EmptyState icon={I.globe} title={`No site called ${name}`} action={<Button onClick={() => goSites(sitesHref({ view: 'list' }))}>Back to sites</Button>}>
        It may have been deleted, or the link has a typo.
      </EmptyState>
    );
  }
  if (!ed.current) return <QueryError error={ed.detail.error ?? ed.draftQuery.error} what="this site" />;

  const s = ed.current;
  const d = ed.detail.data;
  const status = ed.system ? 'platform' : d?.status ?? 'draft';
  const liveVersion = d?.applied?.version;
  const tabs: Array<{ value: SiteTab; label: string }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'routes', label: 'Routes' },
    { value: 'gates', label: 'Gates' },
    { value: 'access', label: 'Access' },
    ...(ed.system ? [] : [{ value: 'login' as const, label: 'Login' }]),
    { value: 'status', label: 'Status' },
    { value: 'history', label: 'History' },
    ...(ed.system ? [] : [{ value: 'settings' as const, label: 'Settings' }]),
    ...((ed.hasDraft || tab === 'review') && !readOnly ? [{ value: 'review' as const, label: 'Review & apply' }] : []),
  ];
  const upstream = s.upstream ? `${s.upstream.scheme ?? 'http'}://${s.upstream.service}.${s.upstream.namespace}:${s.upstream.port}` : '—';

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow={<Button variant="ghost" size="sm" icon={I.caretLeft} onClick={() => goSites(sitesHref({ view: 'list' }))}>Sites</Button>}
        title={s.displayName ?? name}
        status={<span className="row gap-8"><StatusBadge status={status} />{liveVersion && <Badge tone="plain">v{liveVersion}</Badge>}</span>}
        sub={<span className="mono">{s.address?.host}{s.address?.pathPrefix ?? ''} → {upstream}</span>}
        actions={<>
          <Button size="md" icon={I.route} kbd="t" onClick={() => go('routes', { test: 'GET /' })}>Test a URL</Button>
          {s.address?.host && <Button size="md" trailing={I.arrowOut} onClick={() => window.open(`https://${s.address!.host}${s.address!.pathPrefix ?? ''}/`, '_blank', 'noopener')}>Open site</Button>}
        </>}
      />

      {ed.system && (
        <Callout tone="info" icon={I.lock} className="mb-12" title="System site">
          Managed by the platform chart. You can look, test and link here; changes happen in the chart (values: kratos-login-ui / oathkeeper rules). Your sites can't use these paths on this host.
        </Callout>
      )}
      {!ed.system && !perms.canDraft && (
        <Callout tone="info" icon={I.info} className="mb-12">You can look around. Changing sites needs a super admin.</Callout>
      )}
      {perms.canApply && !ed.system && <PendingRequests name={name} onApplied={() => invalidate(name)} />}
      {ed.hasDraft && !readOnly && tab !== 'review' && (
        <Callout
          tone="warning"
          icon={I.edit}
          className="mb-12 site-draft-banner"
          actions={<>
            <Button size="sm" variant="ghost" onClick={() => void ed.discard()}>Discard</Button>
            <Button size="sm" variant="primary" kbd="⌘↵" onClick={() => go('review')}>Review &amp; apply</Button>
          </>}
        >
          {ed.neverSaved ? 'Draft — this site has never been applied.' : `${ed.changes.length || 'Some'} unapplied change${ed.changes.length === 1 ? '' : 's'}${ed.changes.length ? ` (${ed.changes.join(', ')})` : ''} — visitors still see version ${liveVersion ?? d?.version ?? '—'}.`}
          {ed.draftQuery.data?.updatedBy && <span className="muted"> By {ed.draftQuery.data.updatedBy}{ed.draftQuery.data.updatedAt ? `, ${timeAgo(ed.draftQuery.data.updatedAt)}` : ''}.</span>}
          <span className="muted small"> {ed.saving === 'pending' || ed.saving === 'saving' ? 'Saving…' : ed.saving === 'failed' ? `Not saved: ${ed.saveError}` : ed.saving === 'saved' ? 'Saved.' : ''}</span>
        </Callout>
      )}

      <Tabs label={`${s.displayName ?? name} sections`} idBase="site" items={tabs} value={tabs.some((t) => t.value === tab) ? tab : 'overview'} onChange={(t) => go(t)} className="site-tabs" />
      <div id={`site-panel-${tab}`} role="tabpanel" aria-labelledby={`site-tab-${tab}`} className="site-panel">
        {tab === 'overview' && <OverviewTab ed={ed} go={go} />}
        {tab === 'routes' && <RoutesTab ed={ed} readOnly={readOnly} query={query} go={go} />}
        {tab === 'gates' && <GatesTab ed={ed} readOnly={readOnly} query={query} go={go} />}
        {tab === 'access' && <AccessTab ed={ed} readOnly={readOnly} query={query} go={go} />}
        {tab === 'login' && !ed.system && <LoginTab ed={ed} readOnly={readOnly} />}
        {tab === 'status' && <StatusTab ed={ed} />}
        {tab === 'history' && <HistoryTab ed={ed} readOnly={readOnly || !perms.canApply} query={query} go={go} />}
        {tab === 'settings' && !ed.system && <SettingsTab ed={ed} readOnly={readOnly} canApply={perms.canApply} />}
        {tab === 'review' && !readOnly && <ReviewTab ed={ed} canApply={perms.canApply} go={go} />}
      </div>
    </div>
  );
}

export type Go = (tab: SiteTab, query?: Record<string, string | undefined>) => void;
