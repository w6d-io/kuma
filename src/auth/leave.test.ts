import { describe, it, expect, vi, beforeEach } from 'vitest';

// Signing out has to destroy four things, and three of them leave no trace on screen when they are
// missed: the console shows a sign-in either way. So each is asserted separately.

const { sessionMock } = vi.hoisted(() => ({
  sessionMock: {
    signsInWithToken: vi.fn(() => false),
    signOut: vi.fn(async () => false),
  },
}));

vi.mock('./session', () => sessionMock);

const { leave, identityBaseUrl, consoleUrl } = await import('./leave');

describe('identityBaseUrl', () => {
  it('prefers the address the deployment gave, path and all', () => {
    // Behind a path prefix the self-service endpoints move with it, and assuming the root would ask
    // whatever else answers there.
    expect(identityBaseUrl({ __KRATOS_PUBLIC_URL__: 'https://auth.test/kratos/' }))
      .toBe('https://auth.test/kratos');
  });

  it('falls back to the host it already knows', () => {
    expect(identityBaseUrl({ __AUTH_DOMAIN__: 'auth.test' })).toBe('https://auth.test');
  });

  it('reads an unsubstituted placeholder as nothing', () => {
    expect(identityBaseUrl({ __KRATOS_PUBLIC_URL__: '${KRATOS_PUBLIC_URL}', __AUTH_DOMAIN__: 'auth.test' }))
      .toBe('https://auth.test');
    expect(identityBaseUrl({})).toBe('');
  });
});

describe('leave', () => {
  let clearCaches: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCaches = vi.fn<() => void>();
    sessionMock.signsInWithToken.mockReturnValue(false);
    sessionMock.signOut.mockResolvedValue(false);
    window.sessionStorage.setItem('left-behind', 'x');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://auth.test', pathname: '/admin/', href: '', search: '' },
    });
  });

  it('empties what this console holds before going anywhere', async () => {
    await leave(clearCaches);

    expect(clearCaches).toHaveBeenCalled();
    expect(window.sessionStorage.getItem('left-behind')).toBeNull();
  });

  it('hands over to the authority, and comes back to the console itself', async () => {
    sessionMock.signsInWithToken.mockReturnValue(true);
    sessionMock.signOut.mockResolvedValue(true);

    await leave(clearCaches);

    // The console it was being used from — not another application's sign-in screen, which would
    // say somebody signed out of something they were not using.
    expect(sessionMock.signOut).toHaveBeenCalledWith('https://auth.test/admin/');
    // Handed over: nothing else may redirect, or the hand-over is cancelled mid-flight.
    expect(window.location.href).toBe('');
  });

  it('ends the session where the deployment signs in with one', async () => {
    (window as never as Record<string, unknown>)['__KRATOS_PUBLIC_URL__'] = 'https://auth.test/kratos';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ logout_url: 'https://auth.test/kratos/self-service/logout?token=t' }),
    })));

    await leave(clearCaches);

    expect(window.location.href).toBe(
      'https://auth.test/kratos/self-service/logout?token=t&return_to=' +
        encodeURIComponent('https://auth.test/admin/'),
    );
  });

  it('still leaves the console when nothing answers', async () => {
    (window as never as Record<string, unknown>)['__KRATOS_PUBLIC_URL__'] = 'https://auth.test/kratos';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('refused'); }));

    await leave(clearCaches);

    // Staying on a console somebody asked to leave is the worse outcome, and the reload is what
    // shows its own sign-in.
    expect(window.location.href).toBe(consoleUrl());
    expect(clearCaches).toHaveBeenCalled();
  });
});
