/**
 * An organisation's tenant: a namespace-shaped label (lowercase, digits, inner dashes, at most 63).
 * The same rules jinbe applies, so the form can show what it will derive and refuse what it will
 * refuse, before anything is sent.
 */
export const TENANT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** `Acme Corp` → `acme-corp`. Empty when the name has nothing a namespace can carry. */
export function tenantFrom(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** What is wrong with a create/rename form, in words, or null. */
export function orgFormProblem(name: string, tenant: string): string | null {
  if (!name.trim()) return 'Give the organization a name.';
  if (name.trim().length > 200) return 'Keep the name under 200 characters.';
  const t = tenant.trim() || tenantFrom(name);
  if (!t) return 'This name has no letters or digits to make a tenant from; enter one.';
  if (!TENANT.test(t)) return 'A tenant is lowercase letters, digits and inner dashes, at most 63.';
  return null;
}

/** What is wrong with the owner's address on a create form, in words, or null. */
export function ownerProblem(email: string): string | null {
  const v = email.trim();
  if (!v) return 'Give the owner’s email address.';
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'An email address, like jane@example.com.';
  return null;
}
