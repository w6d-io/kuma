import type { Access, Check } from './types';

/** Small wordings shared by the Sites screens. */

export type CheckLevel = 'ok' | 'warn' | 'error' | 'pending' | 'info';

export const checkLines = (checks: readonly Check[]): Array<{ level: CheckLevel; text: string }> =>
  checks.map((c) => ({ level: c.level === 'error' ? 'error' : 'warn', text: c.message }));

export function accessWord(a: Access): string {
  switch (a.kind) {
    case 'public': return 'Public';
    case 'signed-in': return 'Signed-in';
    case 'deny': return 'Refused';
    case 'permission': return a.permission;
  }
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
