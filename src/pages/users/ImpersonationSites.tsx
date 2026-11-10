import { useQuery } from '@tanstack/react-query';
import { useSession } from '../../api/hooks';
import { orgAccessApi } from '../../api/orgAccess';
import { siteKeys, sitesApi } from '../../api/sites';
import { siteLinks } from '../../lib/impersonation';
import { holds } from '../../policy/model';

const SHOWN = 8;

/**
 * "Open as this person": the sites they hold a role on, each opening its address in a new tab —
 * where the gateway serves it as them. Built from two answers the console already has (their access,
 * the sites by address); without either, the plain instruction alone. Never a promise that a page
 * will let them in: the site decides, as it does for them.
 */
export function ImpersonationSites({ userId }: { userId: string }) {
  const { data: session } = useSession();
  const maySeeSites = holds(session, 'sites:read');
  // The same key the Access tab reads, so an open drawer asks once.
  const access = useQuery({ queryKey: ['user-access', userId], queryFn: () => orgAccessApi.userAccess(userId), retry: false });
  // The sites by address, for whoever may read them; no refused call for anybody else.
  const hosts = useQuery({ queryKey: siteKeys.hosts(), queryFn: () => sitesApi.hosts(), enabled: maySeeSites, retry: false });
  const links = siteLinks(access.data?.site.byService, hosts.data);
  const more = links.length - SHOWN;

  return (
    <div className="small">
      {links.length > 0 && (
        <>
          <div>Open as this person:</div>
          <ul className="viewing-as-sites">
            {links.slice(0, SHOWN).map((l) => (
              <li key={l.href}>
                <a className="link" href={l.href} target="_blank" rel="noopener noreferrer" title={`${l.href} — opens in a new tab, as them`}>{l.label}</a>
              </li>
            ))}
            {more > 0 && <li className="muted">and {more} more</li>}
          </ul>
        </>
      )}
      <div className="muted">
        {links.length > 0 ? 'Or open any other site in a new tab — it loads as this person.' : 'Open any site in a new tab — it loads as this person.'}
      </div>
    </div>
  );
}
