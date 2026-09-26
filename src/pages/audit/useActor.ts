import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { useUserIdentity } from '../../api/hooks';
import type { AuditActor } from '../../api/audit';
import { actorLabel, type ActorLabel } from '../../lib/audit/format';
import { statusOf } from '../../lib/apiError';

/**
 * Who an event names, pseudonymous until somebody asks. The name comes only from the existing user
 * lookup (`GET /admin/users/:id`), which jinbe authorises and audits like any other read; once looked
 * up, every row with the same id shows it (the lookup is cached under the same key the drawer uses).
 */
export function useActor(actor: AuditActor): { label: ActorLabel; revealed: boolean; email?: string } {
  const id = actor.type === 'user' && actor.id ? actor.id : undefined;
  // enabled=false: read what a lookup already answered, never fetch on render.
  const q = useUserIdentity(id, false);
  if (!id) return { label: actorLabel(actor), revealed: false };
  if (q.data) {
    const t = q.data.traits;
    return { label: actorLabel(actor, { name: t.name, email: t.email }), revealed: true, email: t.email };
  }
  if (statusOf(q.error) === 404) return { label: actorLabel(actor, 'missing'), revealed: true };
  return { label: actorLabel(actor), revealed: false };
}

/** Look an id up on request. Returns the email, or null when it cannot be revealed. */
export function useReveal() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const reveal = async (id: string): Promise<string | null> => {
    setBusy(id);
    setRefused(null);
    try {
      const u = await qc.fetchQuery({ queryKey: ['user-identity', id], queryFn: () => api.getUser(id), staleTime: 5 * 60_000 });
      return u.traits.email ?? null;
    } catch (err) {
      if (statusOf(err) !== 404) setRefused(id);
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { reveal, busy, refused };
}
