import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { useUserIdentity } from '../../api/hooks';
import type { AuditActor } from '../../api/audit';
import { actorLabel, type ActorLabel } from '../../lib/audit/format';
import { statusOf } from '../../lib/apiError';
import { useActorName } from '../../lib/audit/actorNames';

/**
 * Who an event names. jinbe resolves the user ids of every page it serves to somebody who may look
 * people up (`actors`, lib/audit/actorNames.ts); anybody else sees the pseudonymous id, and may still
 * look one person up (`GET /admin/users/:id`, authorised and audited like any other read), after which
 * every row with the same id shows it.
 */
export function useActor(actor: AuditActor): { label: ActorLabel; revealed: boolean; email?: string } {
  const id = actor.type === 'user' && actor.id ? actor.id : undefined;
  const resolved = useActorName(id);
  // enabled=false: read what a lookup already answered, never fetch on render.
  const q = useUserIdentity(id, false);
  if (!id) return { label: actorLabel(actor), revealed: false };
  if (resolved === null) return { label: actorLabel(actor, 'missing'), revealed: true };
  if (resolved && (resolved.name || resolved.email)) {
    return { label: actorLabel(actor, { name: resolved.name ?? undefined, email: resolved.email ?? undefined }), revealed: true, email: resolved.email ?? undefined };
  }
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
