import type { UseQueryResult } from '@tanstack/react-query';
import type { Module, QuickActions as QuickActionsData } from '../../api/home';
import { ActionTile, Skeleton } from '../../components/ui';
import { visibleActions, type Persona } from '../../lib/home/briefing';
import { ModuleFrame } from './ModuleFrame';
import { TILES, fromQuery, useRunAction } from './moduleKit';

/**
 * Quick actions — verbs that open their flow, never a list page (home-design §4.4). Which ones exist
 * is the server's call; a refused one is absent, not greyed.
 */

export function QuickActions({ q, persona }: { q: UseQueryResult<Module<QuickActionsData>, Error>; persona: Persona }) {
  const run = useRunAction(persona);
  return (
    <ModuleFrame<QuickActionsData>
      id="home-actions"
      title="Quick actions"
      className="home-actions"
      {...fromQuery(q)}
      thing="quick actions"
      skeleton={<div className="action-grid" aria-hidden="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={44} />)}</div>}
      notConnected={{ title: "Quick actions aren't available", what: 'The console could not work out what you may do.' }}
    >
      {(data) => {
        const tiles = visibleActions(data.items);
        if (tiles.length === 0) return <p className="home-note">Nothing to do from here with your access.</p>;
        return (
          <div className="action-grid">
            {tiles.map((a) => {
              const t = TILES[a.id];
              const href = t.href?.(persona) ?? undefined;
              const hint = a.reason === 'mfa_required' ? 'Asks for your second factor' : t.hint;
              return <ActionTile key={a.id} icon={t.icon} verb={t.verb(a, persona)} hint={hint} kbd={t.key} href={href} onClick={href ? undefined : () => run(a.id)} />;
            })}
          </div>
        );
      }}
    </ModuleFrame>
  );
}
