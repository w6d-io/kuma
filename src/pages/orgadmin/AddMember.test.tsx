import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type } from '../../components/ui/testing';

// Adding an existing account: found as you type from jinbe's quick find and picked from our own list,
// never from the browser's contacts AutoFill.

vi.mock('../../auth/session', () => ({ bearerToken: async () => null }));

import { AddMember } from './AddMember';

const ORG = '3cb95fec-bc9f-48b1-8fa7-f3da8ed9fff8';
const ID = '6f1c9a52-3b0e-4d0e-9a55-0f3c2b1d7e10';
const ALICE = { id: ID, email: 'alice@example.com', name: 'Alice', active: true, groups: ['ops'], organizations: [], mfa: true };
let calls: Array<{ method: string; url: string }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url) });
    if (String(url).includes('/admin/users/lookup')) return Response.json({ match: 'prefix', data: [ALICE] });
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle(ms = 0) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('Add member', () => {
  it('suggests accounts as you type and adds the picked one by id, with no browser autofill', async () => {
    const toast = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AddMember org={ORG} orgName="test-org" pushToast={toast} /></QueryClientProvider>);
    const input = document.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('name')).toBe('person-search');
    expect(input.getAttribute('inputmode')).toBeNull();
    act(() => { input.focus(); });
    type(input, 'ali');
    await settle(400);
    const option = document.querySelector('[role="option"]') as HTMLElement;
    expect(option.textContent).toContain('alice@example.com');
    act(() => { option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(input.value).toBe('alice@example.com');
    await act(async () => { (document.querySelector('form') as HTMLFormElement).requestSubmit(); });
    await settle();
    // Picked: added by id straight away, no email lookup through the directory.
    expect(calls.some((c) => c.url.includes('/admin/users?'))).toBe(false);
    expect(calls.some((c) => c.method !== 'GET' && c.url.includes(ID))).toBe(true);
    expect(toast).toHaveBeenCalledWith('Added to test-org', expect.anything());
  });
});
