import { describe, it, expect } from 'vitest';
import { readOidcSettings, OidcClient } from './oidc';

// The two decisions worth pinning are the ones taken before any network call: whether this
// deployment signs in against an authority at all, and whether a given page load is the authority
// answering. Both are read from strings a container substituted at start-up, and both have a wrong
// answer that is silent — signing in against a half-configured authority, or mistaking an ordinary
// navigation for a callback and consuming a code that is not there.

describe('readOidcSettings', () => {
  it('reads an authority and a client', () => {
    const settings = readOidcSettings({
      __OIDC_AUTHORITY__: 'https://hydra.example.net/',
      __OIDC_CLIENT_ID__: 'a-client',
      __OIDC_AUDIENCE__: 'https://an-api',
    });

    expect(settings).toEqual({
      authority: 'https://hydra.example.net/',
      clientId: 'a-client',
      audience: 'https://an-api',
    });
  });

  it('reads no authority as not configured, so the cookie redirect stays', () => {
    expect(readOidcSettings({})).toBeNull();
    expect(readOidcSettings({ __OIDC_AUTHORITY__: '', __OIDC_CLIENT_ID__: '' })).toBeNull();
  });

  it('refuses half a configuration rather than guessing the rest', () => {
    // Signing in needs both. One alone would send people to an authority that does not know us.
    expect(readOidcSettings({ __OIDC_AUTHORITY__: 'https://hydra.example.net/' })).toBeNull();
    expect(readOidcSettings({ __OIDC_CLIENT_ID__: 'a-client' })).toBeNull();
  });

  it('reads an unsubstituted placeholder as not configured', () => {
    // envsubst leaves ${VAR} in place when the variable is unset, so this is what an empty setting
    // actually looks like in the browser — not an empty string.
    expect(
      readOidcSettings({ __OIDC_AUTHORITY__: '${OIDC_AUTHORITY}', __OIDC_CLIENT_ID__: '${OIDC_CLIENT_ID}' }),
    ).toBeNull();
  });

  it('treats an absent audience as one the authority infers', () => {
    const settings = readOidcSettings({
      __OIDC_AUTHORITY__: 'https://hydra.example.net/',
      __OIDC_CLIENT_ID__: 'a-client',
    });

    expect(settings?.audience).toBe('');
  });

  it('trims what a substitution left around the value', () => {
    const settings = readOidcSettings({
      __OIDC_AUTHORITY__: '  https://hydra.example.net/  ',
      __OIDC_CLIENT_ID__: ' a-client ',
    });

    expect(settings?.authority).toBe('https://hydra.example.net/');
    expect(settings?.clientId).toBe('a-client');
  });
});

describe('OidcClient.isCallback', () => {
  it('recognises the authority answering with a code', () => {
    expect(OidcClient.isCallback('?code=abc&state=xyz')).toBe(true);
  });

  it('recognises the authority refusing', () => {
    // A refusal has to be read too: without it the console would retry the redirect for ever.
    expect(OidcClient.isCallback('?error=access_denied')).toBe(true);
  });

  it('is not fooled by an ordinary navigation', () => {
    expect(OidcClient.isCallback('')).toBe(false);
    expect(OidcClient.isCallback('?tab=signals')).toBe(false);
  });

  it('ignores the fragment, which is this console own routing', () => {
    // The authority answers in the query string; #/services is ours and must not look like a code.
    expect(OidcClient.isCallback('?')).toBe(false);
  });
});
