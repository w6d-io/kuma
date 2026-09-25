import { describe, it, expect } from 'vitest';
import { summarizeSession, describeAgent } from './sessions';

describe('summarizeSession', () => {
  it('names the method and device in plain words', () => {
    const row = summarizeSession({
      id: 's1',
      active: true,
      authenticated_at: '2026-09-01T10:00:00Z',
      authentication_methods: [{ method: 'password' }, { method: 'totp' }],
      devices: [{ ip_address: '10.0.0.1', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' }],
    });
    expect(row.methods).toEqual(['password', 'authenticator app']);
    expect(row.device).toBe('Safari on macOS · 10.0.0.1');
    expect(row.active).toBe(true);
  });

  it('copes with a bare session', () => {
    expect(summarizeSession({ id: 's2' })).toMatchObject({ id: 's2', active: true, methods: [], device: 'Unknown device' });
  });
});

describe('describeAgent', () => {
  it('tells Chrome from Edge', () => {
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Edge on Windows');
    expect(describeAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36')).toBe('Chrome on Linux');
  });
});
