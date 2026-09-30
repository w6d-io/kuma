import { Badge, Checkbox, TwoFactorBadge, cx } from '../../components/ui';
import { useGroupSecondFactors } from '../../api/twoFactor';
import { blockedForEnrolment } from '../../lib/twoFactor';
import { I } from '../../components/ui/Icons';

/**
 * The site-access group list: what the person holds everywhere, as checkboxes.
 *
 * Every site group, plus anything the target already holds — a membership to a group that no longer
 * exists must stay visible and removable, or it becomes invisible and permanent.
 */
export function SiteGroupRows({ checked, toggle, targetMfa, offered, mayAssign, privileged: isPrivileged, describe }: {
  checked: string[];
  toggle: (g: string) => void;
  targetMfa?: boolean;
  offered: string[];
  mayAssign: boolean;
  /** Gives everything on `global` or a system site. */
  privileged: (group: string) => boolean;
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
        // 2FA gate (a mirror of jinbe's refusal): a group whose members must use two-step sign-in
        // cannot be picked for somebody who never enrolled. A jinbe that does not describe its groups'
        // rule falls back to the old test, privileged groups.
        const rule = secondFactorOf(g);
        const blockedByMfa = !on && (rule ? blockedForEnrolment(rule, targetMfa) : privileged && targetMfa === false);
        const blockedByActor = !mayAssign && !on;
        const blocked = blockedByMfa || blockedByActor;
        const title = blockedByActor
          ? 'Assigning a group needs admin write access.'
          : blockedByMfa
          ? `Members of '${g}' must use two-step sign-in. This person must enrol a second factor (authenticator app, security key or backup codes) before being added.`
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
                  {privileged && <Badge tone="warning" title="Gives everything on a system site"><span className="chip-ico">{I.lock}</span>platform admin</Badge>}
                  {rule?.required && <TwoFactorBadge kind="required" />}
                  {!known && <Badge tone="danger">unknown group</Badge>}
                  {blockedByMfa && !blockedByActor && <TwoFactorBadge kind="needs-enrol" />}
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
