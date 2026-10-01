import { Badge, Button, EmptyRow, I, LoadingRows, RelativeTime, Table, TwoFactorBadge } from '../ui';
import { CreatorCell } from '../../pages/apikeys/parts';
import { useStepUpRules } from '../../api/twoFactor';
import type { Grant } from '../../lib/grants';
import { ExpiresBadge } from './ExpiryPicker';

/**
 * Grants as a table: what, where, why, who granted it and when, and the countdown to its expiry.
 * `orgName` names the organization column; without it the column is left out (one scope only).
 */
export function GrantsList({ grants, loading, onRemove, orgName, empty = 'No individual access: everything comes from groups and roles.' }: {
  grants: Grant[];
  loading?: boolean;
  /** Absent: read-only. */
  onRemove?: (g: Grant) => void;
  orgName?: (org: string | undefined) => string;
  empty?: string;
}) {
  const { ruleOf } = useStepUpRules();
  const cols = 5 + (orgName ? 1 : 0) + (onRemove ? 1 : 0);
  return (
    <Table className="rb-stack">
      <thead>
        <tr>
          <th>Grant</th>
          {orgName && <th>Where</th>}
          <th>Reason</th>
          <th>Granted</th>
          <th>Expires</th>
          <th />
          {onRemove && <th className="actions" aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {loading && <LoadingRows rows={2} cols={cols} />}
        {!loading && grants.length === 0 && <EmptyRow colSpan={cols}>{empty}</EmptyRow>}
        {!loading && grants.map((g) => (
          <tr key={g.id}>
            <td data-label="Grant">
              <span className="row wrap gap-4">
                <Badge tone={g.kind === 'role' ? 'info' : 'plain'} mono={false}>{g.kind}</Badge>
                <span className="mono">{g.name}</span>
                {g.service !== 'jinbe' && <span className="small muted">on {g.service}</span>}
                {g.kind === 'permission' && ruleOf(g.name, g.service) && <TwoFactorBadge kind="recent" rule={ruleOf(g.name, g.service)} />}
              </span>
            </td>
            {orgName && <td data-label="Where">{g.org ? orgName(g.org) : <span className="muted">platform</span>}</td>}
            <td data-label="Reason">{g.reason ? <span className="small">{g.reason}</span> : <span className="small muted">no reason given</span>}</td>
            <td data-label="Granted"><GrantedBy by={g.grantedBy} at={g.grantedAt} /></td>
            <td data-label="Expires"><ExpiresBadge expiresAt={g.expiresAt} /></td>
            <td />
            {onRemove && (
              <td className="actions">
                <Button size="sm" variant="ghost" iconOnly icon={I.trash} aria-label={`Remove ${g.name}`} onClick={() => onRemove(g)} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** jinbe names the granter by address or by account id; the id is resolved where the console can. */
function GrantedBy({ by, at }: { by?: string; at?: string }) {
  if (by && by.includes('@')) {
    return <div className="small"><div className="muted nowrap">{at ? <RelativeTime at={at} /> : '—'}</div><div className="muted">by {by}</div></div>;
  }
  return <CreatorCell id={by ?? null} at={at ?? null} />;
}
