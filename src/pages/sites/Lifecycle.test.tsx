import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render } from '../../components/ui/testing';
import type { EphemeralView } from '../../lib/sites/types';

const h = vi.hoisted(() => ({ extend: vi.fn(), toast: vi.fn() }));
vi.mock('../../api/sites', () => ({
  sitesApi: { extend: h.extend },
  notAvailable: () => false,
  useSitesPlatform: () => ({ data: { ephemeral: { minSec: 3600, maxSec: 604_800, defaultSec: 86_400 } } }),
}));
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: h.toast }) }));

import { EphemeralBadge, ExtendButton, LifetimeField } from './Lifecycle';

const e = (over: Partial<EphemeralView> = {}): EphemeralView => ({
  ttlSec: 43_200, expiresAt: new Date(Date.now() + 2 * 3_600_000 + 60_000).toISOString(), remainingSec: 0, expired: false, setBy: 'a@x', ...over,
});
const mount = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const text = () => document.body.textContent ?? '';
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;

afterEach(cleanup);

describe('ephemeral sites', () => {
  it('counts down on the badge, and says expired once paused', () => {
    mount(<><EphemeralBadge e={e()} /><EphemeralBadge e={e({ expired: true })} /></>);
    expect(text()).toContain('Ephemeral · 2 h 1 min left');
    expect(text()).toContain('Expired (paused)');
  });

  it('extends by the TTL chosen, in seconds, starting from its own', async () => {
    h.extend.mockResolvedValue({ name: 'demo', ephemeral: e() });
    const onDone = vi.fn();
    mount(<ExtendButton name="demo" e={e()} onDone={onDone} />);
    click(button(/^Extend$/));
    const select = document.querySelector('.modal select') as HTMLSelectElement;
    expect(select.value).toBe('43200');
    act(() => { select.value = '259200'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    click(button(/^Extend by 3 days$/));
    await settle();
    expect(h.extend).toHaveBeenCalledWith('demo', 259_200);
    expect(onDone).toHaveBeenCalled();
  });

  it('offers permanent or a TTL for a new site', () => {
    const onChange = vi.fn();
    mount(<LifetimeField value={null} onChange={onChange} />);
    const select = document.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Permanent', 'Ephemeral · 1 hour', 'Ephemeral · 4 hours', 'Ephemeral · 12 hours', 'Ephemeral · 1 day', 'Ephemeral · 3 days', 'Ephemeral · 7 days']);
    act(() => { select.value = '3600'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith(3600);
  });
});
