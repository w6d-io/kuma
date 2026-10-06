import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '../components/ui/testing';

// The composite store reads each admin list only for whoever holds what it asks, and a refusal of
// one of them is never the console's error: a developer (no users:read) once had every page replaced
// by "access denied" half a second after it painted, when the user directory answered 403.

const h = vi.hoisted(() => {
  const h = {
    session: undefined as unknown,
    ready: true,
    enabled: {} as Record<string, boolean>,
    errors: {} as Record<string, unknown>,
    query: (name: string) => (enabled = true) => {
      h.enabled[name] = enabled;
      return { data: enabled ? [] : undefined, error: h.errors[name] ?? null, isError: !!h.errors[name], isLoading: false, isSuccess: enabled && !h.errors[name] };
    },
  };
  return h;
});
vi.mock('./hooks', () => ({
  useSession: () => ({ data: h.session, isSuccess: h.ready }),
  useUsers: (_search: unknown, enabled = true) => {
    h.enabled.users = enabled;
    return { users: [], usersLoading: false, error: h.errors.users ?? null, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() };
  },
  useGroups: h.query('groups'),
  useServices: h.query('services'),
  useAllRoles: () => ({ data: {}, isSuccess: true }),
  useAllRoutes: () => ({ data: {}, isSuccess: true }),
}));

import { useStore, type StoreResult } from './store';

let out: StoreResult;
function Probe() { out = useStore(); return null; }
const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });

beforeEach(() => { h.session = undefined; h.ready = true; h.enabled = {}; h.errors = {}; });
afterEach(() => cleanup());

describe('useStore', () => {
  it('asks only what the session holds: a developer never reads the user directory', () => {
    h.session = { permissions: ['sites:read', 'groups:read'] };
    render(<Probe />);
    expect(h.enabled).toEqual({ users: false, groups: true, services: true });
    expect(out.apiError).toBeNull();
    expect(out.isLoading).toBe(false);
  });

  it('a 403 of one list is not the console’s error; a 503 is', () => {
    h.session = { permissions: ['users:read', 'groups:read', 'sites:read'] };
    h.errors.users = forbidden;
    render(<Probe />);
    expect(out.apiError).toBeNull();
    cleanup();
    const down = Object.assign(new Error('down'), { status: 503 });
    h.errors.groups = down;
    render(<Probe />);
    expect(out.apiError).toBe(down);
  });

  it('is loading, and reads nothing, until the session answers', () => {
    h.ready = false;
    render(<Probe />);
    expect(out.isLoading).toBe(true);
    expect(h.enabled).toEqual({ users: false, groups: false, services: false });
  });
});
