import { useState } from 'react';
import type { Organisation } from './directory';

/**
 * Which organisation this session acts in.
 *
 * Shown only when there is a real choice: the token that follows carries the answer, so nothing the
 * console does afterwards can widen it. Picking is therefore the one thing on screen — no shell, no
 * navigation, nothing that suggests the console is usable before the question is answered.
 */
export function OrganisationChoice({
  organisations,
  onChoose,
}: {
  organisations: readonly Organisation[];
  onChoose: (organisationId: string) => Promise<void>;
}) {
  const [refused, setRefused] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  async function choose(organisationId: string) {
    setRefused(null);
    setLeaving(true);
    try {
      // Does not return when it succeeds: the browser leaves to collect a token that carries this.
      await onChoose(organisationId);
    } catch (failure) {
      setLeaving(false);
      setRefused(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <main className="choice">
      <h1>Choose an organization</h1>
      <p className="sub">
        The directory records which one this session acts in. You can still switch between the ones
        you administer once you are inside.
      </p>

      {refused && <p className="refused">That did not go through — {refused}</p>}

      <ul>
        {organisations.map((organisation) => (
          <li key={organisation.id}>
            <button type="button" disabled={leaving} onClick={() => void choose(organisation.id)}>
              <span className="name">{organisation.name}</span>
              <span className="id">{organisation.id}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

/**
 * The directory could not be reached.
 *
 * Told apart from an empty directory on purpose: both leave the console with nothing to show, and
 * only one of them is something the reader could act on.
 */
export function DirectoryUnavailable({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <main className="choice">
      <h1>Can’t reach the organization directory</h1>
      <p className="sub">
        Your organizations are held elsewhere, and that service did not answer — so this session
        cannot be given the access it needs. Nothing is wrong with your account.
      </p>
      <p className="refused">{reason}</p>
      <ul>
        <li>
          <button type="button" onClick={onRetry}>
            <span className="name">Try again</span>
          </button>
        </li>
      </ul>
    </main>
  );
}
