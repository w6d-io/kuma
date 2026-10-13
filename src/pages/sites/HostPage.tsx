import { useRef, type KeyboardEvent } from 'react';
import { Badge, Button, ButtonBase, EmptyState, I, PageHeader, SkeletonPanel, cx } from '../../components/ui';
import { ApiErrorState } from '../../components/ApiErrorState';
import { notAvailable, useHost, useZones } from '../../api/sites';
import { goSites, sitesHref } from '../../lib/sites/route';
import { accessChips, hostTree, prefillWizardForHost } from '../../lib/sites/hosts';
import { useSitePerms } from './usePerms';
import { HostServicePanel } from './HostService';

/**
 * One address (Sites by address, phase 1): every service mounted on the host as a path tree — nested
 * paths drawn under the path that encloses them, the longest prefix wins — and the selected one on the
 * right (`?site=`). Editing stays in each site's own tabs; "Add a service here" opens Plug a site with
 * the host filled in.
 */
export function HostPage({ host, query }: { host: string; query: Record<string, string> }) {
  const perms = useSitePerms();
  const detail = useHost(host);
  const zones = useZones();
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  if (detail.isLoading) return <div className="page-enter"><SkeletonPanel lines={6} /></div>;
  const back = <Button variant="ghost" icon={I.caretLeft} onClick={() => goSites(sitesHref({ view: 'list' }))}>All addresses</Button>;
  if (detail.error) {
    if ((detail.error as { status?: number }).status === 404 && !notAvailable(detail.error)) {
      return <EmptyState icon={I.globe} title={`No site is on ${host}`} action={back}>It may have moved to another address, or the link has a typo.</EmptyState>;
    }
    return <div className="page-enter">{back}<ApiErrorState error={detail.error} what="this address" onRetry={() => void detail.refetch()} /></div>;
  }
  const h = detail.data!;
  const rows = hostTree(h.services);
  const selected = h.services.find((s) => s.site === query.site) ?? rows[0]?.service;
  const select = (site: string) => goSites(sitesHref({ view: 'host', host: h.host, query: { site } }));
  const addHere = () => {
    prefillWizardForHost(h.host, (zones.data ?? []).map((z) => z.suffix));
    goSites(sitesHref({ view: 'new' }));
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : null;
    if (next === null || next < 0 || next >= rows.length) return;
    e.preventDefault();
    items.current[next]?.focus();
    select(rows[next].service.site);
  };

  return (
    <div className="page-enter">
      <PageHeader
        title={<span className="mono">{h.host}</span>}
        sub={`${h.counts.services} service${h.counts.services === 1 ? '' : 's'} on this address${h.zone ? ` · in ${h.zone}` : ''}`}
        actions={<span className="row gap-8 wrap">{back}{perms.canDraft && <Button variant="primary" icon={I.plus} onClick={addHere}>Add a service here</Button>}</span>}
      />
      <div className="host-split">
        <nav aria-label={`Services on ${h.host}`}>
          <ul role="tree" aria-label={`Paths on ${h.host}`} className="host-tree">
            {rows.map(({ service: s, depth }, i) => {
              const sel = s.site === selected?.site;
              return (
                <li key={s.site} role="none">
                  <ButtonBase
                    ref={(el: HTMLButtonElement | null) => { items.current[i] = el; }}
                    role="treeitem"
                    aria-level={depth + 1}
                    aria-selected={sel}
                    tabIndex={sel ? 0 : -1}
                    className={cx('host-tree-item', `host-depth-${Math.min(depth, 4)}`, sel && 'is-selected')}
                    onClick={() => select(s.site)}
                    onKeyDown={(e: KeyboardEvent) => onKey(e, i)}
                  >
                    <span className="mono host-tree-path">{s.pathPrefix ?? '/'}</span>
                    <span className="row gap-4 wrap">
                      {accessChips(s.access).slice(0, 2).map((c) => <Badge key={c.word} tone={c.tone} mono={false}>{c.word}</Badge>)}
                      {s.draft && <Badge tone="plain" mono={false} icon={I.edit}>draft</Badge>}
                    </span>
                    <span className="small muted host-tree-sub">
                      {s.upstream ? `${s.upstream.service}.${s.upstream.namespace}` : 'no backend'}
                      {s.sharedBackendWith.length > 0 && ` · also used by ${s.sharedBackendWith.length} other site${s.sharedBackendWith.length === 1 ? '' : 's'}`}
                    </span>
                  </ButtonBase>
                </li>
              );
            })}
          </ul>
        </nav>
        <section aria-label="Selected service">
          {selected ? <HostServicePanel s={selected} /> : <EmptyState icon={I.globe} title="No service here yet">Add one with "Add a service here".</EmptyState>}
        </section>
      </div>
    </div>
  );
}
