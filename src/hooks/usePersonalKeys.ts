import { useQuery } from '@tanstack/react-query';
import { accountsApi } from '../api/accounts';
import { statusOf } from '../lib/apiError';

export const MY_API_KEYS = ['my-api-keys'] as const;

/** Your personal keys. One query for the page and the rail, so both learn the feature is off at once. */
export function useMyApiKeys() {
  return useQuery({ queryKey: MY_API_KEYS, queryFn: () => accountsApi.listMyApiKeys(), retry: false, staleTime: 30_000 });
}

/** jinbe answers 404 on every personal-key route while the platform has them switched off. */
export function personalKeysOff(err: unknown): boolean {
  return statusOf(err) === 404;
}

/**
 * Whether the rail lists Connections & keys: once jinbe has answered, and not with "off". An outage
 * keeps the entry — the page says what went wrong — while "off" hides it.
 */
export function usePersonalKeysEnabled(): boolean {
  const q = useMyApiKeys();
  return q.isSuccess || (q.isError && !personalKeysOff(q.error));
}
