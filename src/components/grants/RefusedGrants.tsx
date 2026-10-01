import { grantLabel } from '../../lib/grants';
import type { RefusedGrant } from '../../api/grants';

/** What jinbe would not grant, one line each: which grant, why, what is missing, who could. */
export function RefusedGrants({ refused, lead = 'Nothing was granted. Refused:' }: { refused: RefusedGrant[]; lead?: string }) {
  if (refused.length === 0) return null;
  return (
    <div role="alert" className="orgs-refused">
      <div className="small fw-medium text-danger">{lead}</div>
      <ul className="small orgs-refused-list">
        {refused.map((r) => (
          <li key={`${r.service}|${r.kind}|${r.name}`}>
            <span className="mono">{grantLabel({ service: r.service, kind: r.kind === 'role' ? 'role' : 'permission', name: r.name })}</span>
            {' — '}{(r.reasons.length ? r.reasons : [r.reason]).map(reasonWords).join('; ')}
            {r.missing.length > 0 && <> · you would need <span className="mono">{r.missing.join(', ')}</span></>}
            {r.grantedBy.length > 0 && <span className="muted"> · held through {r.grantedBy.join(', ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function reasonWords(reason: string): string {
  switch (reason) {
    case 'grant_exceeds_own':
    case 'missing_permissions': return 'it gives what you do not hold';
    case 'missing_every_org_permissions': return 'it reaches into every organization further than you do';
    case 'grant_permission_missing':
    case 'missing_grant_permission': return 'you may not grant here';
    case 'unknown_role': return 'no such role';
    case 'unknown_permission': return 'no such permission';
    case 'unknown_group': return 'no such group';
    case 'org_not_entitled':
    case 'app_not_entitled': return 'this organization is not entitled to that site';
    case 'not_org_member':
    case 'grantee_not_member': return 'they are not a member of this organization';
    case 'invalid_definition': return 'that grant is not valid';
    case 'never_direct': return 'it is never given directly: it comes with its group only';
    default: return reason || 'refused';
  }
}
