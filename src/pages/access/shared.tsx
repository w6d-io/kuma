import { Badge, Callout, I, TwoFactorBadge } from '../../components/ui';
import { useStepUpRules } from '../../api/twoFactor';

export function ReadOnlyNote({ what }: { what: string }) {
  return (
    <Callout tone="neutral" icon={I.lock} className="mb-12">
      You can look around. Changing {what} needs groups:write.
    </Callout>
  );
}

/** Shown instead of edit buttons on what code or a site intent defines (jinbe answers 409 defined_in_code). */
export function DefinedInCodeNote({ what, where = 'defined in code', plural = false }: { what: string; where?: string; plural?: boolean }) {
  return (
    <Callout tone="neutral" icon={I.lock} className="mb-12">
      {what} {plural ? 'are' : 'is'} {where}: read-only here, whoever you are. It changes with a release, or by publishing the site.
    </Callout>
  );
}

/** The "recent 2FA" mark beside a permission that needs one (the platform's own catalogue only). */
export function StepUpMark({ permission, site }: { permission: string; site?: string }) {
  const { ruleOf } = useStepUpRules();
  const rule = ruleOf(permission, site);
  return rule ? <TwoFactorBadge kind="recent" rule={rule} /> : null;
}

/**
 * A role's permissions as chips. With `site`, each permission that needs a recent second factor
 * carries the mark.
 */
export function PermChips({ perms, max = 6, site }: { perms: readonly string[]; max?: number; site?: string }) {
  if (perms.length === 0) return <span className="small muted">no permission</span>;
  const shown = perms.slice(0, max);
  return (
    <span className="row wrap gap-4">
      {shown.map(p => site ? <span key={p} className="row gap-4"><Badge>{p}</Badge><StepUpMark permission={p} site={site} /></span> : <Badge key={p}>{p}</Badge>)}
      {perms.length > max && <span className="small muted">+{perms.length - max} more</span>}
    </span>
  );
}
