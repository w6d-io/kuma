import { describe, it, expect } from 'vitest';
import { customAnswers, describeFails, describeGets, describeWho } from './gateWords';
import type { Gate } from './types';

const g = (over: Partial<Gate>): Gate => ({ id: 'b', label: 'B', authenticators: [{ handler: 'cookie_session' }], authorizer: 'policy', mutators: [{ handler: 'header' }], errors: 'website', ...over });

describe('customAnswers', () => {
  it('says nothing for a preset gate', () => {
    expect(customAnswers(g({}))).toEqual({});
  });
  it('cookie + bare bearer: words, the lost tokens, and signed-in-or-tokens as the closest', () => {
    const a = customAnswers(g({ authenticators: [{ handler: 'cookie_session' }, { handler: 'bearer_token' }] }));
    expect(Object.keys(a)).toEqual(['who']);
    expect(a.who).toMatchObject({
      words: 'Signed-in people (cookie) · Kratos session token in Authorization',
      warning: { level: 'warn', text: expect.stringMatching(/OAuth2 \/ API tokens .* rejected/) },
      closest: { value: 'signed-in-or-tokens' },
    });
  });
  it('an empty chain is an error, and closest is signed-in', () => {
    expect(describeWho(g({ authenticators: [] }))).toMatchObject({ words: 'No sign-in method', warning: { level: 'error' }, closest: { value: 'signed-in' } });
  });
  it('names the header a session token is read from', () => {
    expect(describeWho(g({ authenticators: [{ handler: 'bearer_token', config: { token_from: { header: 'X-Token' } } }] })).words).toBe('Kratos session token in X-Token');
  });
  it('mutators and errors', () => {
    expect(describeGets(g({ mutators: [{ handler: 'id_token' }] }))).toMatchObject({ words: 'The service gets a signed ID token (JWT)', closest: { value: 'identity' } });
    expect(describeGets(g({ mutators: [] })).warning?.level).toBe('warn');
    expect(describeFails(g({ errors: [{ handler: 'json' }, { handler: 'www_authenticate' }] }))).toMatchObject({ words: 'JSON errors, else browser password prompt', closest: { value: 'api' } });
  });
});
