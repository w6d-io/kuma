/**
 * Deployments where a session has to say which organisation it acts in before it gets a token for
 * this API.
 *
 * The console knows the shape and never the specifics: an audience that opens a directory, an
 * address that lists what the signed-in person may act in, and an address that records which one
 * they picked. Which directory answers, and what it consults, is the deployment's business — the
 * same reason the authority's name is a setting and not a string in this code.
 *
 * Nothing configured means nothing changes: one sign-in for this API, exactly as before.
 */
export interface DirectorySettings {
  /** The audience of a token that opens the directory and nothing else. */
  readonly audience: string;
  /** Lists the organisations the caller may act in. */
  readonly listUrl: string;
  /** Records the one the caller is acting in. */
  readonly selectUrl: string;
}

export interface Organisation {
  readonly id: string;
  readonly name: string;
}

/** What the container was told at start-up, or null when this deployment has no such step. */
export function readDirectorySettings(
  source: Record<string, unknown> = window as never,
): DirectorySettings | null {
  const audience = setting(source['__ORG_DIRECTORY_AUDIENCE__']);
  const listUrl = setting(source['__ORG_DIRECTORY_URL__']);
  const selectUrl = setting(source['__ORG_SELECTION_URL__']);

  // All three or none. Half of it would sign somebody in against an audience that opens nothing,
  // and leave them on a console that cannot say why.
  if (!audience || !listUrl || !selectUrl) return null;
  return { audience, listUrl, selectUrl };
}

/** An unsubstituted `${VAR}` is what an unset setting looks like in a browser. */
function setting(value: unknown): string {
  const held = typeof value === 'string' ? value.trim() : '';
  return held.startsWith('${') ? '' : held;
}

export class DirectoryUnavailableError extends Error {}

/**
 * What the signed-in person may act in.
 *
 * An empty list is an answer, not a failure: it means the directory holds nothing for them, and the
 * screens say so. A directory that cannot be reached is a failure, and is reported as one rather
 * than shown as an empty list — the two look identical on screen and mean opposite things.
 */
export async function listOrganisations(
  settings: DirectorySettings,
  token: string,
): Promise<readonly Organisation[]> {
  const answer = await fetch(settings.listUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((failure: unknown) => {
    throw new DirectoryUnavailableError(`the directory did not answer: ${String(failure)}`);
  });

  if (!answer.ok) {
    throw new DirectoryUnavailableError(`the directory answered ${answer.status}`);
  }

  const held: unknown = await answer.json();
  if (!Array.isArray(held)) throw new DirectoryUnavailableError('the directory answered no list');

  return held
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry.id === 'string' && entry.id.length > 0)
    .map((entry) => ({
      id: entry.id as string,
      name: typeof entry.name === 'string' && entry.name ? entry.name : (entry.id as string),
    }));
}

/**
 * Record the organisation this session acts in.
 *
 * The identifier is a pointer into the list the directory just answered, never a value this console
 * invented — and the directory checks it again anyway, because a client that could name one could
 * name somebody else's.
 */
export async function selectOrganisation(
  settings: DirectorySettings,
  token: string,
  organisationId: string,
): Promise<void> {
  const answer = await fetch(settings.selectUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ organisationId }),
  }).catch((failure: unknown) => {
    throw new DirectoryUnavailableError(`the directory did not answer: ${String(failure)}`);
  });

  if (!answer.ok) {
    throw new DirectoryUnavailableError(`the directory refused the choice: ${answer.status}`);
  }
}
