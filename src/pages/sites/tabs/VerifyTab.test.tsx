import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, click, render } from '../../../components/ui/testing';
import type { VerifyReport } from '../../../lib/sites/verify';

const api = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('../../../api/sites', () => ({ sitesApi: { verify: api.verify }, notAvailable: () => false }));

import { VerifyTab } from './VerifyTab';
import type { SiteEditor } from '../useSiteEditor';

const report: VerifyReport = {
  site: 'echo', host: 'echo.dev.example.com', version: { saved: 3, applied: 3 }, checkedAt: new Date().toISOString(),
  rollout: { ready: true, checks: [{ id: 'rules', label: 'Gateway rules', status: 'ok', message: 'loaded' }] },
  probe: { available: true, notProbed: [], results: [
    { route: 'reports', method: 'GET', url: 'https://echo.dev.example.com/reports', expect: 'protected', status: 200, verdict: 'exposed', level: 'error', message: 'Answered 200 without sign-in.' },
  ] },
  access: { available: true, source: 'opa', notChecked: [], subjects: [{ key: 'group:admins', kind: 'group', name: 'admins' }], rows: [{ route: 'reports', method: 'GET', path: '/reports', access: 'reports:read', answers: { 'group:admins': 'ok' } }] },
  waf: null,
  curl: [{ route: 'reports', method: 'GET', url: 'https://echo.dev.example.com/reports', anonymous: 'curl -i https://echo.dev.example.com/reports', withToken: 'curl -i -H "Authorization: Bearer $TOKEN" https://echo.dev.example.com/reports' }],
  summary: { ok: false, errors: ['GET /reports is exposed'], warnings: [] },
};
const ed = { name: 'echo', detail: { data: { applied: { version: 3 } } } } as unknown as SiteEditor;
const text = () => document.body.textContent ?? '';
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

afterEach(cleanup);

describe('Verify', () => {
  it('runs on demand and shows the exposure, the matrix and the curl lines', async () => {
    api.verify.mockResolvedValueOnce(report);
    render(<QueryClientProvider client={new QueryClient()}><VerifyTab ed={ed} go={() => {}} /></QueryClientProvider>);
    expect(api.verify).not.toHaveBeenCalled();
    await click(button(/^Run verification/));
    await settle();
    expect(api.verify).toHaveBeenCalledWith('echo', { waf: false });
    expect(text()).toContain('1 problem found');
    expect(text()).toContain('Exposed');
    expect(text()).toContain('Allowed');
    expect([...document.querySelectorAll('input')].map((i) => i.value)).toContain(report.curl[0].withToken);
  });

  it('says when it was run too recently', async () => {
    api.verify.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429, code: 'verify_rate_limited', retryAfter: 12 }));
    render(<QueryClientProvider client={new QueryClient()}><VerifyTab ed={ed} go={() => {}} /></QueryClientProvider>);
    await click(button(/^Run verification/));
    await settle();
    expect(text()).toContain('Try again in 12 s.');
  });
});
