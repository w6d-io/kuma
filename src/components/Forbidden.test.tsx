import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from './ui/testing';
import { Button } from './ui';

// Every refusal is drawn one way (Forbidden): an API 403 with what it needs and who gives it, a page
// the person may not open — said in its place, never a flash of the page first — and an account
// without staff access. The next step is the caller's slot, "ask an administrator" otherwise.

const h = vi.hoisted(() => ({
  session: undefined as unknown,
  ready: false,
  state: { groups: {} as Record<string, Record<string, string[]>>, roles: {} as Record<string, Record<string, string[]>> },
}));
vi.mock('../api/hooks', () => ({ useSession: () => ({ data: h.session, isSuccess: h.ready }) }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ state: h.state }) }));
vi.mock('../api/twoFactor', () => ({
  twoFactorApi: { catalog: async () => ({ permissions: [{ name: 'users:read', label: 'Find users' }], roles: [] }) },
}));
vi.mock('../auth/leave', () => ({ leave: vi.fn(), identityBaseUrl: () => 'https://auth.example.com' }));

import { ApiErrorState } from './ApiErrorState';
import { PageGate } from './PageForbidden';
import { StaffOnly } from './StaffOnly';

async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const mount = (el: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);
const text = () => document.body.textContent ?? '';
const badges = () => [...document.querySelectorAll('.forbidden .badge')].map((b) => b.textContent);
const developer = { authenticated: true, email: 'dev@example.com', groups: ['staff-developers'], permissions: ['sites:read', 'groups:read', 'orgs:read'] };

beforeEach(() => {
  h.session = undefined;
  h.ready = false;
  h.state = { groups: {}, roles: {} };
});
afterEach(() => cleanup());

describe('an API refusal', () => {
  it('names what it needs, in the catalogue’s words, and the groups that give it', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403, details: { permission: 'users:read', grantedBy: ['staff-support', 'super_admins'] } });
    mount(<ApiErrorState error={err} />);
    await settle();
    expect(document.querySelector('[role=alert].forbidden')).not.toBeNull();
    expect(text()).toContain('Access denied');
    expect(badges()).toEqual(['users:read', 'staff-support', 'super_admins']);
    expect(text()).toContain('Find users');
    expect(text()).toContain('Ask an administrator to add you to one of these groups.');
  });

  it('puts the caller’s next step in place of asking an administrator', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403, details: { permission: 'sites:apply', grantedBy: ['staff-ops'] } });
    mount(<ApiErrorState error={err} nextStep={<Button>Set up two-step sign-in</Button>} />);
    await settle();
    expect(text()).toContain('Set up two-step sign-in');
    expect(text()).not.toContain('Ask an administrator');
  });

  it('a bare 403 says the roles do not cover it, with nothing to badge', () => {
    mount(<ApiErrorState error={Object.assign(new Error('Forbidden'), { status: 403 })} />);
    expect(document.querySelector('.forbidden')).not.toBeNull();
    expect(text()).toContain('Your roles do not include what this needs');
    expect(badges()).toEqual([]);
  });

  it('anything else is not drawn as a refusal', () => {
    mount(<ApiErrorState error={Object.assign(new Error('boom'), { status: 500 })} what="sessions" onRetry={() => {}} />);
    expect(document.querySelector('.forbidden')).toBeNull();
    expect(text()).toContain('Could not load sessions');
  });
});

describe('a page', () => {
  it('draws nothing of the page before the session answers', () => {
    mount(<PageGate page="connections"><p>secret page</p></PageGate>);
    expect(text()).not.toContain('secret page');
    expect(document.querySelector('.skeleton-panel')).not.toBeNull();
  });

  it('a developer opens what his role allows, Connections and API keys included', () => {
    h.session = developer;
    h.ready = true;
    for (const page of ['connections', 'apikeys', 'sites', 'groups'] as const) {
      mount(<PageGate page={page}><p>page {page}</p></PageGate>);
      expect(text()).toContain(`page ${page}`);
      cleanup();
    }
  });

  it('a page he may not open says so in its place, with the permission and the groups that give it', async () => {
    h.session = developer;
    h.ready = true;
    h.state = {
      groups: { 'staff-support': { jinbe: ['support'] }, 'staff-developers': { jinbe: ['developer'] }, shop: { shop: ['admin'] } },
      roles: { jinbe: { support: ['users:read', 'sessions:read'], developer: ['sites:read'] } },
    };
    mount(<PageGate page="users"><p>page users</p></PageGate>);
    await settle();
    expect(text()).not.toContain('page users');
    expect(text()).toContain("You can't open Users");
    expect(badges()).toEqual(['users:read', 'staff-support']);
  });
});

describe('an account without staff access', () => {
  it('is drawn like every refusal, with where to go and how to leave', () => {
    mount(<StaffOnly email="ann@example.com" />);
    expect(document.querySelector('.forbidden')).not.toBeNull();
    expect(text()).toContain('This console is for platform staff');
    expect(text()).toContain('ann@example.com');
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Go to my sites', 'Sign out']);
  });
});
