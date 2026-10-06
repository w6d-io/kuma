import { Badge } from './Badge';
import { I } from './Icons';
import {
  GROUP_REQUIRED_TITLE, NEEDS_ENROL_TITLE, siteNotEnforced, siteScopeLabel, siteScopeSentence, stepUpTitle,
  type SiteSecondFactor, type StepUpRule,
} from '../../lib/twoFactor';

/**
 * The one mark for a second-factor rule, wherever it applies. Same icon, a status tone, and words —
 * never the colour alone — with the rule in full on hover:
 *
 *   required     a group whose members must use two-step sign-in          "2FA required"
 *   recent       a permission that needs a second factor proven recently  "recent 2FA"
 *   site         a site's own bar, when it has one                        "2FA for changes"
 *                — and in danger when a gate skips the policy that enforces it: "2FA NOT enforced"
 *   needs-enrol  a person who joins such a group once they enrol          "joins after 2FA"
 */
export type TwoFactorBadgeProps =
  | { kind: 'required'; title?: string }
  | { kind: 'recent'; rule?: Pick<StepUpRule, 'maxAgeMin' | 'viaPersonalKey' | 'fourEyes'> | null; title?: string }
  | { kind: 'site'; site: SiteSecondFactor | null | undefined; title?: string; /** Why the bar is not enforced, in a sentence. */ notEnforced?: string | null }
  | { kind: 'needs-enrol'; title?: string };

export function TwoFactorBadge(props: TwoFactorBadgeProps) {
  switch (props.kind) {
    case 'required':
      return <Badge tone="warning" icon={I.shield} mono={false} title={props.title ?? GROUP_REQUIRED_TITLE}>2FA required</Badge>;
    case 'recent':
      return <Badge tone="info" icon={I.shield} mono={false} title={props.title ?? stepUpTitle(props.rule)}>recent 2FA</Badge>;
    case 'needs-enrol':
      return <Badge tone="info" icon={I.shield} mono={false} title={props.title ?? NEEDS_ENROL_TITLE}>joins after 2FA</Badge>;
    case 'site': {
      // jinbe's `enforced: false` (list, detail, map) or the screen's own reading of the gates.
      const notEnforced = props.notEnforced ?? (siteNotEnforced(props.site) && (props.site?.summary ?? siteNotEnforced(props.site)));
      if (notEnforced) return <Badge tone="danger" icon={I.shield} mono={false} title={notEnforced}>2FA NOT enforced</Badge>;
      const label = siteScopeLabel(props.site);
      if (!label || !props.site) return null;
      return <Badge tone="info" icon={I.shield} mono={false} title={props.title ?? siteScopeSentence(props.site)}>{label}</Badge>;
    }
  }
}
