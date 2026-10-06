import { Badge, Checkbox, TwoFactorBadge, cx } from '../../components/ui';
import { useGroupSecondFactors } from '../../api/twoFactor';
import { waitsForEnrolment, waitsForEnrolmentSentence } from '../../lib/twoFactor';
import { I } from '../../components/ui/Icons';

/**
 * The site-access group list: what the person holds everywhere, as checkboxes.
 *
 * Every site group, plus anything the target already holds — a membership to a group that no longer
 * exists must stay visible and removable, or it becomes invisible and permanent.
 */
export function SiteGroupRows({ checked, toggle, targetMfa, offered, mayAssign, privileged: isPrivileged, beyond, describe }: {
  checked: string[];
  toggle: (g: string) => void;
  targetMfa?: boolean;
  offered: string[];
  mayAssign: boolean;
  /** Gives platform permissions (a role on jinbe). */
  privileged: (group: string) => boolean;
  /** What the group gives on jinbe that the caller does not hold (the holding rule): not addable. */
  beyond?: (group: string) => string[];
  /** The group in one line: its roles per site. */
  describe: (group: string) => string;
}) {
  const rows = [...new Set([...offered, ...checked])].sort();
  const secondFactorOf = useGroupSecondFactors();
  return (
    <>
      {rows.map((g) => {
        const on = checked.includes(g);
        const known = offered.includes(g);
        const privileged = isPrivileged(g);
        // A group whose members must use two-step sign-in, for somebody who never enrolled: picked all
        // the same, it waits for their second factor (jinbe keeps it and sends them to set one up).
        // A jinbe that does not describe its groups' rule falls back to the old test, privileged groups.
        const rule = secondFactorOf(g);
        const waits = rule ? waitsForEnrolment(rule, targetMfa) : privileged && targetMfa === false;
        const exceeds = beyond?.(g) ?? [];
        const blockedByActor = !on && (!mayAssign || exceeds.length > 0);
        const blocked = blockedByActor;
        const title = blockedByActor
          ? (mayAssign ? `It gives what you do not hold: ${exceeds.join(', ')}.` : 'Adding people to groups needs groups.members:write.')
          : waits
          ? waitsForEnrolmentSentence(g)
          : !known
          ? `Group '${g}' is held but no longer exists, so it grants nothing. It can be removed.`
          : undefined;
        return (
          <div key={g} className="people-sep" title={title}>
            <Checkbox
              className={cx('site-group', on && 'on')}
              checked={on}
              disabled={blocked}
              onChange={() => { if (!blocked) toggle(g); }}
              label={
                <span className="row wrap gap-4 fw-medium text-base">
                  {g}
                  {privileged && <Badge tone="warning" title="Gives platform permissions (jinbe)"><span className="chip-ico">{I.lock}</span>platform</Badge>}
                  {rule?.required && <TwoFactorBadge kind="required" />}
                  {!known && <Badge tone="danger">unknown group</Badge>}
                  {waits && !blockedByActor && <TwoFactorBadge kind="needs-enrol" title={waitsForEnrolmentSentence(g)} />}
                </span>
              }
              hint={known ? describe(g) : undefined}
            />
          </div>
        );
      })}
    </>
  );
}
