import { describe, it, expect } from 'vitest';
import { getPath, setPath, isDuration, HANDLER_FIELDS } from './handlerFields';

describe('config paths', () => {
  it('reads and writes dotted keys', () => {
    const c = setPath({ a: 1 }, 'retry.max_delay', '100ms');
    expect(c).toEqual({ a: 1, retry: { max_delay: '100ms' } });
    expect(getPath(c, 'retry.max_delay')).toBe('100ms');
  });
  it('removes empty values and empty parents', () => {
    expect(setPath({ retry: { max_delay: '1s' } }, 'retry.max_delay', '')).toBeUndefined();
    expect(setPath({ a: ['x'] }, 'a', [])).toBeUndefined();
  });
});

describe('catalog', () => {
  it('locks the global-only fields', () => {
    const intro = HANDLER_FIELDS.authenticators.oauth2_introspection;
    expect(intro.find((f) => f.key === 'introspection_url')?.locked).toBeTruthy();
    expect(HANDLER_FIELDS.authorizers.remote_json.find((f) => f.key === 'remote')?.locked).toBeTruthy();
  });
  it('checks durations', () => {
    expect(isDuration('100ms')).toBe(true);
    expect(isDuration('1 s')).toBe(false);
  });
});
