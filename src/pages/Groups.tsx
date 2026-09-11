import { Chip } from '../components/ui/Primitives';
import { useAuthorizationModel, useStats } from '../api/hooks';
import { scopesOf, grantsEveryOrganisation, hierarchyOf, resolveRoles, summarise, type RoleCatalogue } from '../policy/model';
import { I } from '../components/ui/Icons';
import { SkeletonPanel } from '../components/ui/Skeleton';

/**
 * What each group grants, from the model the engine decides against.
 *
 * This is a REPORT, not an editor. The model lives in Git and changes at a release, because a diff
 * of it is the only way anybody sees a permission change coming — so there is no writer here and
 * there must not be one. Who is IN a group is the opposite kind of fact: it changes daily, and the
 * Users screen owns it.
 *
 * What this replaces read a catalogue from Redis and laid it out as a column per SERVICE — the
 * retired model's shape. It listed groups the policy does not define, omitted every group it does,
 * and offered to edit them, which wrote where nothing reads.
 */
export function GroupsPage() {
  const { data: model, isLoading, error } = useAuthorizationModel();
  const { data: stats } = useStats();

  const groups = model?.groups ?? {};
  const roles = model?.roles ?? {};
  // Derived from the model, not written down beside it: a hierarchy somebody maintains drifts from
  // what the engine decides the first time a role changes.
  const under = hierarchyOf(groups, roles);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Groups</h1>
          <div className="sub">
            <span className="mono">groups.json</span> · what each group grants, per organisation
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
        <div className="small muted">
          Reviewed in Git and shipped with the policy bundle — this screen reports it and cannot
          change it. To add a group or move a permission, change the model and let Argo sync it.
        </div>
      </div>

      {error ? (
        <div className="panel" style={{ padding: 16 }}>
          <strong>The authorization model could not be read.</strong>
          <div className="small muted" style={{ marginTop: 4 }}>
            This is not an empty model: nothing here says what anybody holds. Retry, and check that
            the policy ConfigMaps are present in the namespace.
          </div>
        </div>
      ) : isLoading ? (
        <div aria-busy="true" aria-label="Reading the model"><SkeletonPanel lines={5} /></div>
      ) : Object.keys(groups).length === 0 ? (
        <div className="panel" style={{ padding: 16 }}>
          <span className="small muted">The model declares no group.</span>
        </div>
      ) : (
        <div className="group-cards">
          {Object.entries(groups).map(([group, definition]) => {
            const members = stats?.perGroup?.[group] ?? 0;
            const everywhere = grantsEveryOrganisation(definition);
            const scopes = scopesOf(definition);
            return (
              <div key={group} className="panel" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong className="mono">{group}</strong>
                  {/* Held in every organisation at once. Handing one out goes through the actor's
                      authority, the target's second factor and the actor's own step-up. */}
                  {everywhere && (
                    <Chip tone="accent" title="Held in every organisation at once">
                      <span className="chip-ico">{I.lock}</span>every organisation
                    </Chip>
                  )}
                  <span className="small muted">
                    {members} {members === 1 ? 'member' : 'members'}
                  </span>
                </div>

                <div className="small muted" style={{ marginTop: 4 }}>{summarise(definition, roles)}</div>

                {under[group]?.length > 0 && (
                  /* Not decoration: it answers "is this one stronger than that one", which is the
                     question somebody handing out a group actually has. Read off the model, so it
                     cannot claim a rank the engine does not enforce. */
                  <div className="small muted" style={{ marginTop: 6 }}>
                    Includes everything{' '}
                    {under[group].map((below, i) => (
                      <span key={below}>
                        {i > 0 && ', '}
                        <span className="mono">{below}</span>
                      </span>
                    ))}{' '}
                    {under[group].length === 1 ? 'gives' : 'give'}
                  </div>
                )}

                <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                  {scopes.map(scope => (
                    <ScopeRow
                      key={scope.key}
                      scope={scope.everyOrganisation ? 'Every organisation' : scope.key}
                      roleNames={scope.roles}
                      roles={roles}
                      mono={!scope.everyOrganisation}
                    />
                  ))}
                  {scopes.length === 0 && <span className="small muted">Grants nothing.</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** One organisation a group grants in, and the permissions that follow from its roles there. */
function ScopeRow({
  scope,
  roleNames,
  roles,
  mono,
}: {
  scope: string;
  roleNames: string[];
  roles: RoleCatalogue;
  mono?: boolean;
}) {
  const { permissions, undefined: undefined_ } = resolveRoles(roleNames, roles);

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      <div className={mono ? 'small mono' : 'small'} style={{ color: 'var(--ink-2)' }}>
        {scope}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        {roleNames.length === 0 ? (
          <span className="small muted">no role</span>
        ) : (
          roleNames.map(r => (
            <Chip key={r} tone={roles[r] ? 'info' : 'warn'}>
              {r}
              {!roles[r] && ' · not defined'}
            </Chip>
          ))
        )}
      </div>
      {permissions.length > 0 && (
        <div className="small mono" style={{ marginTop: 6, color: 'var(--ink-2)' }}>
          {permissions.join(' · ')}
        </div>
      )}
      {undefined_.length > 0 && (
        <div className="small" style={{ marginTop: 4, color: 'var(--warn)' }}>
          {undefined_.join(', ')} {undefined_.length === 1 ? 'is' : 'are'} not in{' '}
          <span className="mono">roles.json</span>, so{' '}
          {undefined_.length === 1 ? 'it grants' : 'they grant'} nothing.
        </div>
      )}
    </div>
  );
}
