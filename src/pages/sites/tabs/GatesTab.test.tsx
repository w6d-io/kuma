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

describe('Gates · a sign-in gate that passes no identity', () => {
  it('shows the badge and the warning once, and one click passes the identity headers', async () => {
    const update = mount({ ...gate, authenticators: [{ handler: 'cookie_session' }], mutators: [{ handler: 'noop' }] });
    expect(text()).toContain('Passes no identity');
    expect(text().split('the app receives X-User-* headers empty').length - 1).toBe(1);
    await click(button(/^Pass identity headers$/));
    const next = update.mock.calls[0][0](site) as Site;
    expect(next.gates[0].mutators).toEqual([{ handler: 'header' }]);
  });
  it('says nothing for a public gate', () => {
    mount({ ...gate, authenticators: [{ handler: 'noop' }], authorizer: { handler: 'allow' }, mutators: [{ handler: 'noop' }] });
    expect(text()).not.toContain('Passes no identity');
  });
});

describe('Gates · pass roles and permissions', () => {
  const policyGate: Gate = { ...gate, authenticators: [{ handler: 'cookie_session' }] };
  const box = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => i.closest('label')?.textContent?.includes('X-User-Roles'))!;
  it('is off by default and turns on for a policy gate', async () => {
    const update = mount(policyGate);
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);
    await click(box());
    expect((update.mock.calls[0][0](site) as Site).gates[0].passRoles).toBe(true);
  });
  it('is off and says why on a gate that does not ask the policy', () => {
    mount({ ...policyGate, authorizer: { handler: 'allow' } });
    expect(box().disabled).toBe(true);
    expect(text()).toContain('Only when “Who may pass” checks permissions per route');
  });
});
