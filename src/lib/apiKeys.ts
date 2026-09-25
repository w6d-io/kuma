/** Scopes as typed — commas or spaces, duplicates dropped, order kept. */
export function parseScopes(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * The scopes jinbe accepts, when it said so. A refused create answers the allowed catalogue in its
 * details; there is no endpoint that lists it up front.
 */
export function allowedScopesFrom(err: unknown): string[] | null {
  const details = (err as { details?: { details?: { allowed_scopes?: unknown }; allowed_scopes?: unknown } } | null)?.details;
  const list = details?.details?.allowed_scopes ?? details?.allowed_scopes;
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : null;
}
