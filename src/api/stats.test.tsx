import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '../components/ui/testing';

// After the role trim most staff roles lost stats:read, and the console polled /admin/stats every
// 20 s into a 403. The poll runs only with the permission.

const api = vi.hoisted(() => ({ session: vi.fn(), getStats: vi.fn(async () => ({ total: 42 })) }));
vi.mock('./client', () => ({ api: { session: api.session, getStats: api.getStats }, API_BASE: '' }));

import { useStats } from './hooks';

function Probe() {
  const { data } = useStats();
  return <span>{data ? `total ${data.total}` : 'no stats'}</span>;
}
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Probe /></QueryClientProvider>);

afterEach(() => { cleanup(); api.getStats.mockClear(); });

describe('useStats', () => {
  it('does not ask without stats:read', async () => {
    api.session.mockResolvedValue({ authenticated: true, effective_permissions: ['sites:read'] });
    mount();
    await settle();
    expect(api.getStats).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe('no stats');
  });
  it('asks with stats:read', async () => {
    api.session.mockResolvedValue({ authenticated: true, effective_permissions: ['stats:read'] });
    mount();
    await settle();
    expect(api.getStats).toHaveBeenCalled();
    expect(document.body.textContent).toBe('total 42');
  });
});
