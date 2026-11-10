import type { ReachableSite } from '../../api/impersonation';
import { Callout } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { useReachableSites } from '../../hooks/useImpersonation';
import { groupSites, reachNotice } from '../../lib/impersonation';

const SHOWN = 8;

/**
 * The sites this person can open, as jinbe works it out: the ones they hold a role on, then the ones
 * open to any signed-in person. Before starting (`started` false) it is what they WILL be able to
 * open — names only, since a link would open as the caller. Once started each opens its address in
 * a new tab, where the gateway serves it as them.
 *
 * No role on any site, or nothing at all, is said as a warning and stops nothing: the refusal they
 * get is a thing support may want to see. A list that could not be loaded is not "none": no
 * warning then, and the plain instruction instead.
 */
export function ImpersonationSites({ userId, started, compact = false }: {
  userId: string;
  started: boolean;
  /** Inside a notice that is already a warning (the drawer): the warning as a sentence, not a box. */
  compact?: boolean;
}) {
  const q = useReachableSites(userId);

  if (q.isLoading) return <div className="small muted">Checking which sites they can open…</div>;
  if (!q.data) {
    return (
      <div className="small muted">
        {started
          ? 'Open any site in a new tab — it loads as this person.'
          : 'Which sites they can open could not be checked. Any site opened in another tab will load as them.'}
      </div>
    );
  }

  const { role, signedIn } = groupSites(q.data);
  const notice = reachNotice(q.data);
  return (
    <div className="stack gap-8 small">
      {notice && (compact
        ? <div><span className="fw-medium">{notice.title}.</span> {notice.detail}</div>
        : <Callout tone="warning" icon={I.alert} title={notice.title}>{notice.detail}</Callout>)}
      {role.length > 0 && <SiteGroup label={started ? 'Open as this person:' : 'They will be able to open:'} sites={role} linked={started} />}
      {signedIn.length > 0 && <SiteGroup label="Open to any signed-in person:" sites={signedIn} linked={started} quiet />}
    </div>
  );
}

function SiteGroup({ label, sites, linked, quiet = false }: { label: string; sites: ReachableSite[]; linked: boolean; quiet?: boolean }) {
  const more = sites.length - SHOWN;
  return (
    <div>
      <div className={quiet ? 'muted' : undefined}>{label}</div>
      <ul className="viewing-as-sites" aria-label={label.replace(/:$/, '')}>
        {sites.slice(0, SHOWN).map((s) => (
          <li key={s.url}>
            {linked
              ? <a className="link" href={s.url} target="_blank" rel="noopener noreferrer" title={`${s.url} — opens in a new tab, as them`}>{s.title}</a>
              : <span title={s.url}>{s.title}</span>}
          </li>
        ))}
        {more > 0 && <li className="muted">and {more} more</li>}
      </ul>
    </div>
  );
}
