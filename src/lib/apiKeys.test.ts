import { describe, it, expect } from 'vitest';
import { parseScopes, allowedScopesFrom } from './apiKeys';

describe('parseScopes', () => {
  it('splits on commas and spaces and drops duplicates', () => {
    expect(parseScopes(' api:read, api:write api:read ,')).toEqual(['api:read', 'api:write']);
    expect(parseScopes('   ')).toEqual([]);
  });
});

describe('allowedScopesFrom', () => {
  it('reads the catalogue a refused create answers with', () => {
    const err = { status: 400, details: { message: 'no', details: { allowed_scopes: ['api:read'] } } };
    expect(allowedScopesFrom(err)).toEqual(['api:read']);
  });

  it('is null when the error carries none', () => {
    expect(allowedScopesFrom(new Error('x'))).toBeNull();
  });
});
