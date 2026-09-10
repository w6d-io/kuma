/**
 * Reading the authorization model the engine decides against.
 *
 * A group grants roles per organisation, and `*` means every organisation. That key is not a
 * fallback for the others — it is a scope in its own right, and a group carrying it is held
 * everywhere at once, which is what separates a platform grant from a tenant one.
 */

export const EVERY_ORGANISATION = '*';

export type GroupDefinition = Record<string, string[]>;
export type RoleCatalogue = Record<string, string[]>;

export type Scope = {
  /** The organisation identifier, or `*`. */
  key: string;
  /** True for `*`: granted in every organisation. */
  everyOrganisation: boolean;
  roles: string[];
};

/**
 * The scopes a group grants in, `*` first.
 *
 * Ordering is not cosmetic: the widest grant is the one a reader must not miss under a list of
 * organisation identifiers.
 */
export function scopesOf(definition: GroupDefinition | undefined): Scope[] {
  const entries = Object.entries(definition ?? {}).filter(([, roles]) => (roles ?? []).length > 0);
  const everywhere = entries.filter(([key]) => key === EVERY_ORGANISATION);
  const named = entries.filter(([key]) => key !== EVERY_ORGANISATION);
  return [...everywhere, ...named].map(([key, roles]) => ({
    key,
    everyOrganisation: key === EVERY_ORGANISATION,
    roles: roles ?? [],
  }));
}

/** True when the group is held in every organisation — the shape that makes it a platform grant. */
export function grantsEveryOrganisation(definition: GroupDefinition | undefined): boolean {
  return (definition?.[EVERY_ORGANISATION] ?? []).length > 0;
}

/**
 * What these roles carry, and which of them the catalogue does not define.
 *
 * A role naming nothing grants nothing, and a screen that renders it as an empty list says the same
 * thing as a role that genuinely carries no permission. Naming it is the difference between "this
 * grants nothing" and "this points at something that is missing".
 */
export function resolveRoles(
  roleNames: string[],
  catalogue: RoleCatalogue,
): { permissions: string[]; undefined: string[] } {
  const undefined_ = roleNames.filter(name => !catalogue[name]);
  const permissions = [...new Set(roleNames.flatMap(name => catalogue[name] ?? []))].sort();
  return { permissions, undefined: undefined_ };
}
