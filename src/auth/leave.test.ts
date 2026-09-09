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

  it('empties the caches, and leaves the stored session for the sign-out to read', async () => {
    // The ordering IS the behaviour. Emptying storage first takes away the stored session and the
    // token naming it, so the sign-out has nothing to name the session with — and an authority
    // handed half a request rejects all of it, which looks exactly like a broken session.
    sessionMock.signsInWithToken.mockReturnValue(true);
    sessionMock.signOut.mockImplementation(async () => {
      expect(window.sessionStorage.getItem('left-behind')).toBe('x');
      return true;
    });

    await leave(clearCaches);

    expect(clearCaches).toHaveBeenCalled();
    expect(sessionMock.signOut).toHaveBeenCalled();
  });

  it('empties the stored session once the sign-out could not use it', async () => {
    sessionMock.signsInWithToken.mockReturnValue(true);
    sessionMock.signOut.mockResolvedValue(false);

    await leave(clearCaches);

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

describe('leaving when the authority cannot send the browser back', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://auth.test', pathname: '/admin/', href: '', search: '' },
    });
    (window as never as Record<string, unknown>)['__KRATOS_PUBLIC_URL__'] = 'https://auth.test/kratos';
  });

  it('still ends the session, and still lands on this console', async () => {
    // Naming where to come back to requires naming the session being ended, and an authority handed
    // one without the other refuses the whole request — which is an error page for somebody who
    // asked to leave. So the console falls back to the session it can end, and comes back HERE.
    sessionMock.signsInWithToken.mockReturnValue(true);
    sessionMock.signOut.mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ logout_url: 'https://auth.test/kratos/self-service/logout?token=t' }),
    })));

    await leave(vi.fn<() => void>());

    expect(window.location.href).toBe(
      'https://auth.test/kratos/self-service/logout?token=t&return_to=' +
        encodeURIComponent('https://auth.test/admin/'),
    );
  });

  it('lands on this console even when nothing at all answers', async () => {
    sessionMock.signsInWithToken.mockReturnValue(true);
    sessionMock.signOut.mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('refused'); }));

    await leave(vi.fn<() => void>());

    expect(window.location.href).toBe('https://auth.test/admin/');
  });
});
