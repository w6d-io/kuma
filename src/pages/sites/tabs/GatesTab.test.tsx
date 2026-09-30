import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, render } from '../../../components/ui/testing';
import type { Gate, Site } from '../../../lib/sites/types';

// A gate made over the API ([cookie_session, bare bearer_token]) matched no preset, and Basic showed
// "Customized — see Advanced" over a radio group with nothing selected. It must say what is there.

vi.mock('../../../api/sites', () => ({ useSitesPlatform: () => ({ data: { enabled: undefined } }) }));

import { GatesTab } from './GatesTab';
import type { SiteEditor } from '../useSiteEditor';

const gate: Gate = { id: 'web', label: 'Web', authenticators: [{ handler: 'cookie_session' }, { handler: 'bearer_token' }], authorizer: 'policy', mutators: [{ handler: 'header' }], errors: 'website' };
const site = { name: 'echo', gates: [gate], routes: { items: [], catchAll: { gate: 'web', access: { kind: 'signed-in' } } }, upstream: {} } as unknown as Site;

function mount(g: Gate = gate) {
  const update = vi.fn();
  const ed = { site: { ...site, gates: [g] }, update, preview: { state: 'idle' } } as unknown as SiteEditor;
  render(<GatesTab ed={ed} readOnly={false} query={{}} go={() => {}} />);
  return update;
}
const text = () => document.body.textContent ?? '';
const button = (label: RegExp) => [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;

afterEach(cleanup);

describe('Gates · Basic with a customized answer', () => {
  it('says what is configured, the consequence, and offers the closest preset', async () => {
    const update = mount();
    expect(text()).toContain('Signed-in people (cookie) · Kratos session token in Authorization');
    expect(text()).toMatch(/OAuth2 \/ API tokens are sent to Kratos and rejected/);
    await click(button(/^Use preset: Signed-in people or API tokens/));
    const next = update.mock.calls[0][0](site) as Site;
    expect(next.gates[0].authenticators.map((h) => h.handler)).toEqual(['cookie_session', 'bearer_token', 'oauth2_introspection']);
  });

  it('an empty chain says nobody can sign in', () => {
    mount({ ...gate, authenticators: [] });
    expect(text()).toContain('No sign-in method');
    expect(text()).toContain('Nobody can sign in through this gate');
  });
});
