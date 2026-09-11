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

/**
 * Whether a held permission covers a required one.
 *
 * The model holds exactly ONE implication, and this mirrors it: equal verbs, and the held resource
 * is the required one or an ancestor of it. So `admin:write` covers `admin.membership:write`, and
 * `admin.membership:write` covers nothing else. The dot is the boundary — `admin.member:write` does
 * not cover `admin.membership:write`.
 *
 * Verbs deliberately do not imply one another, and there is no `*`. A console that invented either
 * would light up a control the mutation then refuses.
 */
export function covers(held: string, required: string): boolean {
  if (held === required) return true;
  const [heldResource, heldVerb] = held.split(':');
  const [requiredResource, requiredVerb] = required.split(':');
  if (heldVerb !== requiredVerb) return false;
  return requiredResource.startsWith(`${heldResource}.`);
}

/** Whether this set of held permissions admits the required one. */
export function permits(held: readonly string[] | undefined, required: string): boolean {
  return (held ?? []).some(one => covers(one, required));
}

/**
 * What jinbe's privileged mutations check today — handing out a group, setting an organisation's
 * admin roster, restoring a bundle.
 *
 * Named rather than inlined because it is one permission standing in for several: the tree declares
 * `admin.organisation`, `admin.backup` and the rest, and those routes do not require them yet. The
 * console asks what the API asks, so the two cannot disagree; when the routes declare their own,
 * this splits with them.
 */
export const PRIVILEGED_MUTATION = 'admin.membership:write';
