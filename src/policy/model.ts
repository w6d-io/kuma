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

/** One thing a group gives: a permission, in an organisation or in every one. */
type Grant = { organisation: string; permission: string };

/** Everything a group gives, before any comparison. */
function reachOf(definition: GroupDefinition | undefined, catalogue: RoleCatalogue): Grant[] {
  const reach: Grant[] = [];
  for (const [organisation, roles] of Object.entries(definition ?? {})) {
    for (const role of roles ?? []) {
      for (const permission of catalogue[role] ?? []) reach.push({ organisation, permission });
    }
  }
  return reach;
}

/**
 * Whether a reach already gives this grant.
 *
 * Through the model's OWN implication on both axes: `*` covers any organisation, and `covers`
 * decides the permission. Comparing the sets literally — which is what this first did — put
 * `membership-admin` outside `platform-admin` because `admin:write` and `admin.membership:write` are
 * different strings, and put `premium-operator` outside `platform-operator` because one names an
 * organisation the other does not.
 */
function gives(reach: readonly Grant[], grant: Grant): boolean {
  return reach.some(
    held =>
      (held.organisation === EVERY_ORGANISATION || held.organisation === grant.organisation) &&
      covers(held.permission, grant.permission),
  );
}

/**
 * Whether one group gives everything another gives, and strictly more.
 *
 * DERIVED, never declared. A hierarchy somebody writes down drifts from the model the moment a role
 * changes; this is a reading of the model itself, so it cannot disagree with what the engine
 * decides.
 *
 * Strict on purpose: two groups giving exactly the same thing stand side by side rather than one
 * under the other. And a group giving NOTHING is outside the relation entirely — otherwise every
 * group would claim to stand above the base group, which says nothing about either.
 */
export function dominates(
  above: GroupDefinition | undefined,
  below: GroupDefinition | undefined,
  catalogue: RoleCatalogue,
): boolean {
  const mine = reachOf(above, catalogue);
  const theirs = reachOf(below, catalogue);
  if (theirs.length === 0 || mine.length === 0) return false;
  if (!theirs.every(grant => gives(mine, grant))) return false;
  // Strictly more: otherwise they give the same thing and neither is above.
  return !mine.every(grant => gives(theirs, grant));
}

/** Each group, and the groups it stands strictly above. */
export function hierarchyOf(
  groups: Record<string, GroupDefinition>,
  catalogue: RoleCatalogue,
): Record<string, string[]> {
  const under: Record<string, string[]> = {};
  for (const above of Object.keys(groups)) {
    under[above] = Object.keys(groups)
      .filter(below => below !== above && dominates(groups[above], groups[below], catalogue))
      .sort();
  }
  return under;
}

/**
 * What a group gives, in a sentence — read off the model rather than written beside it.
 *
 * A description somebody maintains says what a group was FOR; this says what it currently gives, so
 * it cannot flatter a group whose roles have changed underneath it. It names the permissions rather
 * than paraphrasing them: `admin.membership:write` is the thing that will be checked, and a reader
 * deciding whether to hand a group out is better served by the string the engine matches than by a
 * friendlier one that might not mean the same.
 */
export function summarise(
  definition: GroupDefinition | undefined,
  catalogue: RoleCatalogue,
): string {
  const reach = reachOf(definition, catalogue);
  if (reach.length === 0) return 'Gives nothing.';

  const everywhere = reach.filter(g => g.organisation === EVERY_ORGANISATION);
  const scoped = reach.filter(g => g.organisation !== EVERY_ORGANISATION);
  const parts: string[] = [];

  if (everywhere.length > 0) {
    parts.push(`${listed(everywhere)} in every organisation`);
  }
  if (scoped.length > 0) {
    const organisations = new Set(scoped.map(g => g.organisation));
    const where =
      organisations.size === 1
        ? 'in one organisation'
        : `in ${organisations.size} organisations`;
    parts.push(`${listed(scoped)} ${where}`);
  }
  return `${parts.join('; ')}.`;
}

/** The permissions of a set of grants, deduplicated and ordered, as a phrase. */
function listed(grants: readonly Grant[]): string {
  const permissions = [...new Set(grants.map(g => g.permission))].sort();
  if (permissions.length === 1) return `Gives ${permissions[0]}`;
  const last = permissions[permissions.length - 1];
  return `Gives ${permissions.slice(0, -1).join(', ')} and ${last}`;
}
