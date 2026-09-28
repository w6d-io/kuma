import { useSyncExternalStore } from 'react';

/**
 * Who the user ids of the audit trail are, as jinbe resolved them beside each page it served
 * (`actors`: id → {email, name}, null for a deleted account). jinbe sends it only to somebody who
 * may look people up; the events themselves carry ids only. Kept for the tab, so a row, the facet
 * list and the detail all name the same person once any of them has been read.
 */

export type ActorName = { email: string | null; name: string | null } | null;

const known = new Map<string, ActorName>();
const listeners = new Set<() => void>();
let version = 0;

/** Merges a page's `actors` directory. Absent (the caller may not see names): nothing changes. */
export function rememberActors(actors: Record<string, ActorName> | undefined | null): void {
  if (!actors || typeof actors !== 'object') return;
  let changed = false;
  for (const [id, who] of Object.entries(actors)) {
    const key = id.toLowerCase();
    if (known.has(key) && JSON.stringify(known.get(key)) === JSON.stringify(who)) continue;
    known.set(key, who ?? null);
    changed = true;
  }
  if (!changed) return;
  version += 1;
  listeners.forEach((l) => l());
}

/** undefined: not resolved (show the id); null: the account no longer exists; else who it is. */
export function actorName(id: string | null | undefined): ActorName | undefined {
  return id ? known.get(id.toLowerCase()) : undefined;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** actorName, re-rendering when a later page resolves the id. */
export function useActorName(id: string | null | undefined): ActorName | undefined {
  useSyncExternalStore(subscribe, () => version);
  return actorName(id);
}

/** Test seam. */
export function forgetActors(): void {
  known.clear();
  version += 1;
}
