/**
 * The name/email edit, reduced to what actually changed.
 *
 * `PUT /admin/users/:id` merges `traits` over the stored ones, so sending only the changed fields
 * leaves the rest alone. One email for now — the identity schema carries a single address.
 */
export interface ProfileDraft {
  name: string;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function profileError(draft: ProfileDraft): string | null {
  if (!draft.email.trim()) return 'Email is required.';
  if (!EMAIL.test(draft.email.trim())) return 'That is not an email address.';
  return null;
}

export function profileChange(
  current: ProfileDraft,
  draft: ProfileDraft,
): { traits: Partial<ProfileDraft> } | null {
  const traits: Partial<ProfileDraft> = {};
  const name = draft.name.trim();
  const email = draft.email.trim();
  if (name !== current.name.trim()) traits.name = name;
  if (email.toLowerCase() !== current.email.trim().toLowerCase()) traits.email = email;
  return Object.keys(traits).length ? { traits } : null;
}
