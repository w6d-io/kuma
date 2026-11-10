import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render } from './ui/testing';

const h = vi.hoisted(() => ({ toasts: [] as unknown[][] }));
vi.mock('../auth/session', () => ({ bearerToken: async () => null }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: (...a: unknown[]) => h.toasts.push(a) }) }));

import { ImpersonationBanner } from './ImpersonationBanner';

const T0 = Date.parse('2026-11-10T10:00:00Z');
const active = (seconds: number, name = 'Bob Stone') => ({
  target: { id: 'u-bob', email: 'bob@example.com', name },
  reason: 'Ticket 4821', startedAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + seconds * 1000).toISOString(), mode: 'read',
});

type Call = { method: string; url: string };
let calls: Call[] = [];
let state: unknown;
let stopStatus = 204;
function serve(initial: unknown) {
  calls = [];
  state = initial;
  stopStatus = 204;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', url: String(url) };
    calls.push(c);
    if (c.method === 'DELETE') {
      if (stopStatus !== 204) return new Response(JSON.stringify({ error: 'Internal Server Error', message: 'boom' }), { status: stopStatus });
      state = { ...(state as object), active: null };
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
/** Lets `seconds` go by, one tick at a time, the way the page lives them. */
async function pass(seconds: number) {
  for (let i = 0; i < seconds; i++) await act(async () => { vi.advanceTimersByTime(1000); });
  await flush();
}
const banner = () => document.body.querySelector('.viewing-as-banner');
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === label) ?? null;
let qc: QueryClient;
async function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ImpersonationBanner /></QueryClientProvider>);
  await flush();
}

beforeEach(() => {
  h.toasts = [];
  // The clock and the once-a-second tick only: the queries keep their real timers.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], now: T0 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('ImpersonationBanner', () => {
  it('nothing while nobody is being viewed as, where the feature is off, or on a jinbe without it', async () => {
    serve({ enabled: true, allowed: true, active: null });
    await mount();
    expect(banner()).toBeNull();
    cleanup();
    serve({ enabled: false, allowed: false, active: active(600) });
    await mount();
    expect(banner()).toBeNull();
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 })));
    await mount();
    expect(banner()).toBeNull();
  });

  it('says who, read-only and how long is left, with Stop and a link to the person', async () => {
    serve({ enabled: true, allowed: true, active: active(30 * 60) });
    await mount();
    expect(calls).toEqual([{ method: 'GET', url: '/api/admin/impersonation' }]);
    const el = banner()!;
    expect(el.textContent).toContain('Viewing sites as Bob Stone — read-only — 30:00 left');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Viewing as');
    // The sentence is announced once; the ticking clock is not.
    expect(el.querySelector('[role="status"]')!.textContent).toBe('Viewing sites as Bob Stone — read-only');
    const timer = el.querySelector('[role="timer"]')!;
    expect(timer.getAttribute('aria-live')).toBe('off');
    expect(el.querySelector('[role="status"]')!.contains(timer)).toBe(false);
    expect(el.querySelector('a')!.getAttribute('href')).toBe('#/people/u-bob');
    expect(button('Stop')).not.toBeNull();
  });

  it('falls back to the address for somebody without a name', async () => {
    serve({ enabled: true, allowed: true, active: active(600, '') });
    await mount();
    expect(banner()!.textContent).toContain('Viewing sites as bob@example.com — read-only — 10:00 left');
  });

  it('counts down every second', async () => {
    serve({ enabled: true, allowed: true, active: active(90) });
    await mount();
    expect(banner()!.textContent).toContain('01:30 left');
    await pass(5);
    expect(banner()!.textContent).toContain('01:25 left');
  });

  it('when the time runs out: gone, a notice says it ended, and jinbe is asked again', async () => {
    serve({ enabled: true, allowed: true, active: active(3) });
    await mount();
    expect(banner()!.textContent).toContain('00:03 left');
    const before = calls.length;
    // jinbe still answers the same one for a moment: the strip must not wait for it.
    await pass(3);
    expect(banner()).toBeNull();
    expect(h.toasts).toEqual([['Viewing as Bob Stone ended', { sub: 'The time ran out. Sites open as you again.', ttl: 12000 }]]);
    expect(calls.slice(before)).toEqual([{ method: 'GET', url: '/api/admin/impersonation' }]);
    await pass(3);
    expect(h.toasts).toHaveLength(1);
  });

  it('Stop: one click, no question, and the strip goes', async () => {
    serve({ enabled: true, allowed: true, active: active(600) });
    await mount();
    click(button('Stop'));
    await flush();
    expect(calls.filter(c => c.method === 'DELETE')).toEqual([{ method: 'DELETE', url: '/api/admin/impersonation' }]);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(banner()).toBeNull();
    expect(h.toasts).toEqual([['Stopped viewing as Bob Stone', { sub: 'Sites open as you again.' }]]);
  });

  it('a Stop that failed leaves the strip up and says it is still on', async () => {
    serve({ enabled: true, allowed: true, active: active(600) });
    await mount();
    stopStatus = 500;
    click(button('Stop'));
    await flush();
    expect(banner()).not.toBeNull();
    expect(h.toasts[0][0]).toBe('Could not stop viewing as — it is still on');
  });

  it('stopped from another tab: goes on the next answer, without an expiry notice', async () => {
    serve({ enabled: true, allowed: true, active: active(600) });
    await mount();
    // Stopped from another tab.
    state = { enabled: true, allowed: true, active: null };
    await act(async () => { await qc.invalidateQueries({ queryKey: ['impersonation'] }); });
    await flush();
    expect(banner()).toBeNull();
    expect(h.toasts).toEqual([]);
  });
});
