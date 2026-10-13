import { useEffect, useState } from 'react';
import { parseSitesHash, type SitesView } from '../../lib/sites/route';
import { SitesList } from './SitesList';
import { AddressList } from './AddressList';
import { HostPage } from './HostPage';
import { SiteDetailPage } from './SiteDetail';
import { PlugWizard } from './wizard/PlugWizard';
import { MigrationPage } from './Migration';
import { DeletionInbox } from './Deletions';
import './sites.css';

/**
 * Sites (site-ux.md §3): the addresses and one host's services (Sites by address), the flat list
 * of every site (`?show=all`), the Plug-a-site wizard, one site's tabs, and the one-time
 * migration. The console's router hands this page `#/sites[/<param>]`; the rest of the address —
 * tab, step, selection — is read here so every state is a link.
 */
function useSitesView(): SitesView {
  const [view, setView] = useState(() => parseSitesHash(window.location.hash));
  useEffect(() => {
    const on = () => setView(parseSitesHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return view;
}

export function SitesPage() {
  const view = useSitesView();
  switch (view.view) {
    case 'list': return view.query.show === 'all' ? <SitesList query={view.query} /> : <AddressList query={view.query} />;
    case 'host': return <HostPage key={view.host} host={view.host} query={view.query} />;
    case 'new': return <PlugWizard step={view.step} query={view.query} />;
    case 'migrate': return <MigrationPage step={view.step} />;
    case 'deletions': return <DeletionInbox />;
    case 'site': return <SiteDetailPage key={view.name} name={view.name} tab={view.tab} query={view.query} />;
  }
}
