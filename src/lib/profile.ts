/**
 * The name edit, reduced to what actually changed.
 *
 * `PUT /admin/users/:id` merges `traits` over the stored ones, so sending only the changed fields
 * leaves the rest alone. It refuses an address change (422 `use_email_endpoint`): the address goes
 * through `POST /admin/users/:id/email` (lib/userAddress.ts), so the draft never carries one.
 */
export interface ProfileDraft {
  name: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why this is not an address, or null when it is one. */
export function emailError(value: string): string | null {
  if (!value.trim()) return 'Email is required.';
  if (!EMAIL.test(value.trim())) return 'That is not an email address.';
  return null;
}

export function profileChange(
  current: ProfileDraft,
  draft: ProfileDraft,
): { traits: Partial<ProfileDraft> } | null {
  const name = draft.name.trim();
  return name !== current.name.trim() ? { traits: { name } } : null;
}
