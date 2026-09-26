import { useEffect, useState } from 'react';
import { parseSitesHash, type SitesView } from '../../lib/sites/route';
import { SitesList } from './SitesList';
import { SiteDetailPage } from './SiteDetail';
import { PlugWizard } from './wizard/PlugWizard';
import { MigrationPage } from './Migration';
import './sites.css';

/**
 * Sites (site-ux.md §3): the list, the Plug-a-site wizard, one site's tabs, and the one-time
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
    case 'list': return <SitesList query={view.query} />;
    case 'new': return <PlugWizard step={view.step} query={view.query} />;
    case 'migrate': return <MigrationPage step={view.step} />;
    case 'site': return <SiteDetailPage key={view.name} name={view.name} tab={view.tab} query={view.query} />;
  }
}
