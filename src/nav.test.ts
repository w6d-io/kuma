import { describe, it, expect } from 'vitest';
import { NAV, navBlocks, navItemFor } from './nav';
import { PAGE_IDS } from './api/types';

describe('the rail', () => {
  it('reads in the K-4 order, with People, Access and Compliance as headings', () => {
    const blocks = navBlocks(NAV).map((b) => b.section ?? b.items[0].name);
    expect(blocks).toEqual([
      'Home', 'Sites', 'People', 'Access', 'Organizations', 'API keys', 'Audit', 'Settings', 'Backup', 'Compliance', 'My org',
    ]);
  });

  it('puts users and groups under People, roles and the checker under Access', () => {
    const under = (s: string) => navBlocks(NAV).find((b) => b.section === s)!.items.map((i) => i.id);
    expect(under('People')).toEqual(['users', 'groups']);
    expect(under('Access')).toEqual(['roles', 'accesscheck']);
    expect(under('Compliance')).toEqual(['accessreview', 'recertification']);
  });

  it('only lists pages the router knows', () => {
    for (const n of NAV) expect(PAGE_IDS).toContain(n.id);
  });

  it('has Sites as all sites and gateway handlers, the old gateway rules gone', () => {
    expect(navBlocks(NAV).find((b) => b.section === 'Sites')!.items.map((i) => i.id)).toEqual(['sites', 'gateway']);
    expect(navItemFor('design')).toBeUndefined();
  });
});
