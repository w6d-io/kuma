/**
 * What to tell somebody when the list of organisations is empty.
 *
 * The two cases look identical on screen and are opposites underneath. When this console owns the
 * membership model, an empty list means somebody has to be added to a group — actionable advice.
 * When the deployment reads organisations from the verified token, this console owns nothing: the
 * list is empty because the authority said so, and advising the reader to ask an administrator here
 * sends them to a screen that cannot help them.
 *
 * The authority is NAMED by the deployment and never by this code. A console that hardcoded the
 * name of one directory would stop being portable the moment somebody else ran it.
 */
export type OrganisationScope = 'delegated' | 'claim' | 'all';

/** The name the deployment gave its directory, or nothing. */
export function readAuthorityName(source: Record<string, unknown> = window as never): string {
  const held = source['__ORG_AUTHORITY__'];
  const value = typeof held === 'string' ? held.trim() : '';
  // envsubst leaves ${VAR} in place when the variable is unset, so that literal reads as unnamed.
  return value.startsWith('${') ? '' : value;
}

export interface EmptyOrganisationsHint {
  /** What the reader is told. */
  readonly message: string;
  /** Whether anything on this screen could change the outcome. */
  readonly actionable: boolean;
}

export function emptyOrganisationsHint(
  scope: OrganisationScope,
  authority: string = readAuthorityName(),
): EmptyOrganisationsHint {
  if (scope === 'claim') {
    const named = authority
      ? `Organizations are managed in ${authority}, not here.`
      : 'Organizations are managed by your identity provider, not here.';
    return {
      message: `${named} Your account is not attached to any, so there is nothing to administer.`,
      actionable: false,
    };
  }
  return {
    message:
      'You don’t administer any organizations. Ask a platform administrator to add you to a group that grants here.',
    actionable: true,
  };
}

/**
 * The line shown alongside a NON-empty list, so the reader knows where it came from before they try
 * to change it here.
 */
export function organisationsSourceNote(
  scope: OrganisationScope,
  authority: string = readAuthorityName(),
): string | null {
  if (scope !== 'claim') return null;
  return authority
    ? `Managed in ${authority} — read-only here.`
    : 'Managed by your identity provider — read-only here.';
}
