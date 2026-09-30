import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ request }));

import { accountsApi } from './accounts';

const refused = (status: number) => Object.assign(new Error('x'), { status });

beforeEach(() => request.mockReset());

describe('disconnect all signed-in apps', () => {
  it('uses the one route when jinbe has it', async () => {
    request.mockResolvedValue(undefined);
    await accountsApi.revokeAllMcpConnections(['a', 'b']);
    expect(request.mock.calls).toEqual([['/me/mcp/connections', { method: 'DELETE' }]]);
  });

  it('disconnects each one on a jinbe without it (404), and says when one failed', async () => {
    request.mockRejectedValueOnce(refused(404)).mockResolvedValueOnce(undefined).mockRejectedValueOnce(refused(503));
    await expect(accountsApi.revokeAllMcpConnections(['a', 'b'])).rejects.toMatchObject({ status: 503 });
    expect(request.mock.calls.map((c) => c[0])).toEqual(['/me/mcp/connections', '/me/mcp/connections/a', '/me/mcp/connections/b']);
  });

  it('does not fall back on any other refusal', async () => {
    request.mockRejectedValueOnce(refused(403));
    await expect(accountsApi.revokeAllMcpConnections(['a'])).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
