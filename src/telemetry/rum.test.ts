import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rumSettings } from './rum';

describe('rumSettings', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reads what the API says to report and where', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ faroUrl: 'https://faro/collect', serviceName: 'kuma', version: '1.2.3', environment: 'dev' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    expect(await rumSettings('/api')).toMatchObject({ faroUrl: 'https://faro/collect', serviceName: 'kuma' });
  });

  it('treats a deployment that configures nothing as off, not as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    expect(await rumSettings('/api')).toBeNull();
  });

  it('stays silent when the API cannot answer — the console still starts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(rumSettings('/api')).resolves.toBeNull();
  });

  it('stays silent on a refusal and on a body that is not what it claims', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    expect(await rumSettings('/api')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    expect(await rumSettings('/api')).toBeNull();
  });
});

describe('startRum', () => {
  it('does nothing, and loads nothing, without a collector', async () => {
    // The library must not be imported at all when there is nothing to report to.
    const { startRum } = await import('./rum');
    await expect(startRum(null)).resolves.toBeUndefined();
    await expect(startRum({ serviceName: 'kuma' })).resolves.toBeUndefined();
    await expect(startRum({ faroUrl: 'https://faro/collect' })).resolves.toBeUndefined();
  });
});
