import { rgbCss } from '../../../lib/sites/color';
import { accentProblem } from '../../../lib/sites/validate';
import type { Site, SiteLogin } from '../../../lib/sites/types';
import type { SiteEditor } from '../useSiteEditor';

/**
 * The site's brand — `login.branding` in the intent — read and written in one place, so the Settings
 * and Login tabs edit the same fields the same way. An emptied field is dropped, and an empty
 * branding is no branding: the sign-in pages then fall back to the display name and the platform
 * accent.
 */

export const DEFAULT_LOGIN: SiteLogin = { twoFactor: { scope: 'none', clients: 'exempt' }, reach: 'granted' };

export type Branding = NonNullable<SiteLogin['branding']>;

export function useBrand(ed: SiteEditor) {
  const site = ed.site;
  const login = site?.login ?? DEFAULT_LOGIN;
  const branding: Branding = login.branding ?? {};
  const setLogin = (fn: (l: SiteLogin) => SiteLogin) => ed.update((s: Site) => ({ ...s, login: fn(s.login ?? DEFAULT_LOGIN) }));
  const setBranding = (patch: Partial<Branding>) => setLogin((l) => {
    const next = { ...(l.branding ?? {}), ...patch };
    for (const k of Object.keys(next) as Array<keyof typeof next>) if (!next[k]) delete next[k];
    return { ...l, branding: Object.keys(next).length ? next : undefined };
  });
  const accent = branding.accent ? accentProblem(branding.accent) : null;
  return {
    login,
    branding,
    setLogin,
    setBranding,
    /** The contrast check of the accent as typed; null while there is none. */
    accent,
    /**
     * What the sign-in pages show: the brand name or the display name, and only an accent that
     * passes — with the button label login-ui picks for it (white or ink).
     */
    shown: {
      name: branding.name || site?.displayName || ed.name,
      accent: accent && !accent.problem ? branding.accent : undefined,
      accentText: accent && !accent.problem ? rgbCss(accent.labelColour) : undefined,
    },
  };
}
