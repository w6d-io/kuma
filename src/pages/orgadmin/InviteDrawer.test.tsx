import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type } from '../../components/ui/testing';

// Somebody new joins an organization only through an invitation: an address and the roles given on
// acceptance, posted to …/invitations; the link is shown once. Nobody's account is created here.

vi.mock('../../auth/session', () => ({ bearerToken: async () => null }));

import { InviteDrawer } from './InviteDrawer';

const ORG = '3cb95fec-bc9f-48b1-8fa7-f3da8ed9fff8';
let calls: Array<{ method: string; url: string; body?: unknown }> = [];
let reply: { status: number; body: unknown } = { status: 201, body: null };

beforeEach(() => {
  calls = [];
  reply = {
    status: 201,
    body: {
      invitation: { id: 'i1', org: ORG, email: 'dana@example.com', roles: ['crm:user'], invitedBy: { id: null, email: 'sam@example.com' }, byPlatform: false, createdAt: '2026-10-06T10:00:00Z', expiresAt: '2026-10-20T10:00:00Z' },
      token: 'tok-1', link: null,
    },
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <InviteDrawer org={ORG} assignable={[{ role: 'crm:user', permissions: ['crm:use'], assignable: true }]} onClose={vi.fn()} onDone={vi.fn()} pushToast={vi.fn()} />
  </QueryClientProvider>,
);

describe('Invite by email', () => {
  it('posts the address and the roles, then shows the token once', async () => {
    mount();
    type(document.querySelector('input[placeholder="user@example.com"]'), 'dana@example.com');
    await act(async () => { (document.querySelector('.orgs-pick input') as HTMLInputElement).click(); });
    await act(async () => { button('Invite').click(); });
    await settle();
    const post = calls.find((c) => c.method === 'POST');
    expect(new URL(post!.url, 'http://x').pathname).toBe(`/api/organizations/${ORG}/invitations`);
    expect(post!.body).toEqual({ email: 'dana@example.com', roles: ['crm:user'] });
    expect(document.body.textContent).toContain('Invitation token');
    expect((document.querySelector('.copy-field input') as HTMLInputElement).value).toBe('tok-1');
  });

  it('says an existing member is already one', async () => {
    reply = { status: 409, body: { error: 'Conflict', code: 'already_member', message: 'This person is already a member of the organization.' } };
    mount();
    type(document.querySelector('input[placeholder="user@example.com"]'), 'bob@example.com');
    await act(async () => { button('Invite').click(); });
    await settle();
    expect(document.body.textContent).toContain('Already a member');
  });
});
