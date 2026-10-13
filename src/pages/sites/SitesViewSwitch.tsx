import { Segmented } from '../../components/ui';
import { goSites, sitesHref } from '../../lib/sites/route';

/** "By address" or "All sites": two ways to read the same sites (nothing is merged). */
export function SitesViewSwitch({ value }: { value: 'address' | 'all' }) {
  return (
    <Segmented
      label="Show sites"
      value={value}
      onChange={(v) => goSites(sitesHref({ view: 'list', query: { show: v === 'all' ? 'all' : undefined } }))}
      options={[{ value: 'address', label: 'By address' }, { value: 'all', label: 'All sites' }]}
    />
  );
}
