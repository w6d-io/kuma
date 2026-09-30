import { Badge } from './Badge';
import { I } from './Icons';
import {
  GROUP_REQUIRED_TITLE, NEEDS_ENROL_TITLE, siteScopeLabel, siteScopeSentence, stepUpTitle,
  type SiteSecondFactor, type StepUpRule,
} from '../../lib/twoFactor';

/**
 * The one mark for a second-factor rule, wherever it applies. Same icon, a status tone, and words —
 * never the colour alone — with the rule in full on hover:
 *
 *   required     a group whose members must use two-step sign-in          "2FA required"
 *   recent       a permission that needs a second factor proven recently  "recent 2FA"
 *   site         a site's own bar, when it has one                        "2FA for changes"
 *   needs-enrol  a person who cannot join such a group yet                "needs 2FA enrolled"
 */
export type TwoFactorBadgeProps =
  | { kind: 'required'; title?: string }
  | { kind: 'recent'; rule?: Pick<StepUpRule, 'maxAgeMin' | 'viaPersonalKey' | 'fourEyes'> | null; title?: string }
  | { kind: 'site'; site: SiteSecondFactor | null | undefined; title?: string }
  | { kind: 'needs-enrol'; title?: string };

export function TwoFactorBadge(props: TwoFactorBadgeProps) {
  switch (props.kind) {
    case 'required':
      return <Badge tone="warning" icon={I.shield} mono={false} title={props.title ?? GROUP_REQUIRED_TITLE}>2FA required</Badge>;
    case 'recent':
      return <Badge tone="info" icon={I.shield} mono={false} title={props.title ?? stepUpTitle(props.rule)}>recent 2FA</Badge>;
    case 'needs-enrol':
      return <Badge tone="danger" icon={I.shield} mono={false} title={props.title ?? NEEDS_ENROL_TITLE}>needs 2FA enrolled</Badge>;
    case 'site': {
      const label = siteScopeLabel(props.site);
      if (!label || !props.site) return null;
      return <Badge tone="info" icon={I.shield} mono={false} title={props.title ?? siteScopeSentence(props.site)}>{label}</Badge>;
    }
  }
}
