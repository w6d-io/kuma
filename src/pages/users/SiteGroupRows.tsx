import { Badge, Checkbox, cx } from '../../components/ui';
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
  return (
    <>
      {rows.map((g) => {
        const on = checked.includes(g);
        const known = offered.includes(g);
        const privileged = isPrivileged(g);
        // MFA gate (frontend mirror of jinbe's backend refusal): a privileged group cannot be picked
        // for a target user without a second factor.
        const blockedByMfa = privileged && targetMfa === false && !on;
        const blockedByActor = !mayAssign && !on;
        const blocked = blockedByMfa || blockedByActor;
        const title = blockedByActor
          ? 'Assigning a group needs admin write access.'
          : blockedByMfa
          ? `Group '${g}' grants admin privileges. Target user must enroll a second factor (TOTP / security key / backup codes) before assignment.`
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
                  {!known && <Badge tone="danger">unknown group</Badge>}
                  {blockedByMfa && !blockedByActor && <Badge tone="danger">MFA required</Badge>}
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
