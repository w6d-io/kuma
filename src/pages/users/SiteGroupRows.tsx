import { Badge, Checkbox, cx } from '../../components/ui';
import { I } from '../../components/ui/Icons';
import { isPrivilegedGroup } from '../../hooks/useRbac';
import type { GroupDefinition } from '../../policy/model';

/**
 * The site-access group list: what the person holds everywhere, as checkboxes.
 *
 * Everything the model declares, plus anything the target already holds — a membership the catalogue
 * no longer offers must stay visible and removable, or it becomes invisible and permanent.
 */
export function SiteGroupRows({ checked, toggle, targetMfa, offered, mayAssign, modelGroups, legacy }: {
  checked: string[];
  toggle: (g: string) => void;
  targetMfa?: boolean;
  offered: string[];
  mayAssign: boolean;
  modelGroups: Record<string, GroupDefinition>;
  /** What the PREVIOUS model mapped each group to, when it mapped anything. */
  legacy: Record<string, Record<string, string[]>>;
}) {
  const rows = [...new Set([...offered, ...checked])].sort();
  return (
    <>
      {rows.map((g) => {
        const on = checked.includes(g);
        const known = offered.includes(g);
        // "Privileged" means what it means to the engine: granting in every organisation.
        const privileged = isPrivilegedGroup(g, modelGroups);
        // MFA gate (frontend mirror of jinbe's backend refusal): a privileged group cannot be picked
        // for a target user without a second factor.
        const blockedByMfa = privileged && targetMfa === false && !on;
        // Whether this actor may hand out anything at all is the model's answer, not a role name.
        const blockedByActor = !mayAssign && !on;
        const blocked = blockedByMfa || blockedByActor;
        const title = blockedByActor
          ? 'Assigning a group needs a group that grants in every organisation.'
          : blockedByMfa
          ? `Group '${g}' grants admin privileges. Target user must enroll a second factor (TOTP / security key / backup codes) before assignment.`
          : !known
          ? `Group '${g}' is held but is not declared in the enforced model, so it grants nothing. It can be removed.`
          : undefined;
        const map = legacy[g] ?? {};
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
                  {privileged && <Badge tone="warning" title="Grants in every organisation"><span className="chip-ico">{I.lock}</span>privileged</Badge>}
                  {!known && <Badge tone="danger">not in the model</Badge>}
                  {blockedByMfa && !blockedByActor && <Badge tone="danger">MFA required</Badge>}
                </span>
              }
              // Silent when the previous model mapped nothing: an empty mapping says nothing about
              // the enforced model.
              hint={Object.keys(map).length > 0
                ? Object.entries(map).map(([s, rs]) => `${s}: ${rs.join(',')}`).join(' · ')
                : undefined}
            />
          </div>
        );
      })}
    </>
  );
}
