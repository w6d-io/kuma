import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { homeApi, type HomeModuleKey, type HomeModules, type HomeParams, type HomeResponse } from '../../api/home';

/**
 * The Home's data: one `GET /api/home` on load, then each module on its own timer through
 * `GET /api/home/:module` (home-design §5), so a module loads, fails and refreshes on its own and a
 * slow source never holds the page. Every timer pauses while the tab is hidden and refetches on
 * focus (react-query's defaults).
 */

/** How often each module refreshes while visible. `me` only changes with a reload. */
export const CADENCE: Record<HomeModuleKey, number | false> = {
  health: 15_000, attention: 30_000, sites: 30_000, people: 30_000,
  activity: 60_000, access: 60_000, changes: 60_000, actions: 60_000, me: false,
};

/** A module still warming its cache is asked again sooner. */
const WARMING_RETRY = 15_000;

type HttpError = Error & { status?: number };

/** Only these read the window; the rest keep their cache when it changes. */
const WINDOWED: ReadonlySet<HomeModuleKey> = new Set(['activity', 'access']);

/**
 * Keyed on the org only: the window changes two modules, which refetch themselves, so changing it
 * never reloads the page. The aggregate is fetched with whatever window is current at the time.
 */
export function useHomeAggregate(params: HomeParams) {
  return useQuery<HomeResponse, HttpError>({
    queryKey: ['home', 'all', params.org ?? ''],
    queryFn: () => homeApi.get(params),
    staleTime: 15_000,
    // A refusal or "could not tell who you are" is an answer, not a blip: say it at once.
    retry: (n, err) => ![401, 403, 503].includes(err.status ?? 0) && n < 2,
    refetchOnWindowFocus: false,
  });
}

export function useHomeModule<K extends HomeModuleKey>(
  name: K,
  params: HomeParams,
  agg: { data?: HomeResponse; dataUpdatedAt: number },
) {
  const fromAgg = agg.data?.modules[name] as HomeModules[K] | undefined;
  const windowed = WINDOWED.has(name);
  // The aggregate's copy seeds the module only if it was computed for the same window.
  const seeded = windowed && agg.data?.window !== params.window ? undefined : fromAgg;
  const cadence = CADENCE[name];
  return useQuery<HomeModules[K], HttpError>({
    queryKey: windowed ? ['home', name, params.org ?? '', params.window] : ['home', name, params.org ?? ''],
    queryFn: () => homeApi.module(name, params),
    // Forbidden is a fact about the caller, the same in every window.
    enabled: !!fromAgg && fromAgg.status !== 'forbidden' && (cadence !== false || !seeded),
    initialData: seeded,
    initialDataUpdatedAt: agg.dataUpdatedAt,
    staleTime: cadence === false ? Infinity : cadence,
    refetchInterval: (q) => {
      const m = q.state.data;
      if (!m || m.status === 'forbidden' || cadence === false) return false;
      return m.reason === 'warming' ? WARMING_RETRY : cadence;
    },
    retry: 1,
  });
}

/** Refresh every module now (the ⟳ button and `r`), each through its own endpoint. */
export function useHomeRefresh() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'home' && q.queryKey[1] !== 'all' }), [qc]);
}
