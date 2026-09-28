import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render } from './ui/testing';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

const h = vi.hoisted(() => ({ data: undefined as unknown, mutate: vi.fn(), toast: vi.fn() }));
vi.mock('../api/hooks', () => ({
  useMcpSettings: () => ({ data: h.data, isError: false }),
  useSetMcpSettings: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock('../api/orgCatalog', () => ({ useOrgCatalog: () => ({ orgs: [{ id: ORG_A, name: 'Acme' }, { id: ORG_B, name: 'Globex' }], isLoading: false, error: null }) }));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: h.toast }) }));

import { McpSettings } from './McpSettings';
import { fromMcpDraft, mcpDraftProblems, personalExpiryChoices, sameMcp, toMcpDraft } from '../lib/mcpSettings';

afterEach(() => { cleanup(); h.mutate.mockReset(); });

const settings = (over: Record<string, unknown> = {}) => ({ enabled: true, serverUrl: null, personalKeys: { maxDays: 30 }, allowedOrgs: 'all', ...over });
const view = (over: Record<string, unknown> = {}, ceiling = true) => ({
  settings: settings(over), defaults: settings(),
  ceiling: { enabled: ceiling, note: ceiling ? null : 'DELEGATED_TOKENS_ENABLED is false' },
  effective: ceiling && (over.enabled ?? true),
});

const byText = (root: HTMLElement, sel: string, text: RegExp) =>
  [...root.querySelectorAll<HTMLElement>(sel)].find((e) => text.test(e.textContent ?? ''))!;
const click = (el: HTMLElement) => act(() => { el.click(); });
function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('McpSettings', () => {
  it('shows the switch on, and saves it turned off as the whole document', () => {
    h.data = view();
    const { container } = render(<McpSettings />);
    expect(container.textContent).toContain('AI assistants (MCP)');
    const save = byText(container, 'button', /^Save$/) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    click(container.querySelector<HTMLElement>('[aria-label="Allow AI assistants"]')!);
    expect(container.textContent).toContain('Existing keys are kept');
    click(save);
    expect(h.mutate).toHaveBeenCalledWith(settings({ enabled: false }), expect.anything());
  });

  it('says the deployment keeps it off whatever is saved', () => {
    h.data = view({}, false);
    const { container } = render(<McpSettings />);
    expect(container.textContent).toContain('Switched off by this deployment');
    expect(container.textContent).toContain('off by the deployment');
    expect(container.textContent).toContain('DELEGATED_TOKENS_ENABLED');
  });

  it('checks the server address inline', () => {
    h.data = view();
    const { container } = render(<McpSettings />);
    const input = container.querySelector<HTMLInputElement>('input.mono')!;
    type(input, 'http://mcp.example.com');
    expect(container.textContent).toContain('An https:// address');
    expect((byText(container, 'button', /^Save$/) as HTMLButtonElement).disabled).toBe(true);
    type(input, 'https://mcp.example.com/mcp');
    click(byText(container, 'button', /^Save$/));
    expect(h.mutate).toHaveBeenCalledWith(settings({ serverUrl: 'https://mcp.example.com/mcp' }), expect.anything());
  });

  it('limits to some organizations: needs at least one, then saves their ids', () => {
    h.data = view();
    const { container } = render(<McpSettings />);
    click(byText(container, 'button', /^Only some$/));
    expect(container.textContent).toContain('Pick at least one organization');
    expect((byText(container, 'button', /^Save$/) as HTMLButtonElement).disabled).toBe(true);
    click(byText(container, 'label', /^Globex$/));
    click(byText(container, 'button', /^Save$/));
    expect(h.mutate).toHaveBeenCalledWith(settings({ allowedOrgs: [ORG_B] }), expect.anything());
  });
});

describe('lib/mcpSettings', () => {
  it('round-trips a document and compares org lists in any order', () => {
    const s = { enabled: false, serverUrl: 'https://m.example.com', personalKeys: { maxDays: 7 }, allowedOrgs: [ORG_B, ORG_A] };
    expect(fromMcpDraft(toMcpDraft(s))).toEqual({ ...s, allowedOrgs: [ORG_A, ORG_B] });
    expect(sameMcp(s, { ...s, allowedOrgs: [ORG_A, ORG_B] })).toBe(true);
    expect(fromMcpDraft({ ...toMcpDraft(s), serverUrl: '  ' }).serverUrl).toBeNull();
  });

  it('refuses a URL with credentials or another scheme, and an empty org selection', () => {
    const d = toMcpDraft({ enabled: true, serverUrl: null, personalKeys: { maxDays: 30 }, allowedOrgs: 'all' });
    expect(mcpDraftProblems({ ...d, serverUrl: 'https://u:p@x.io' }).serverUrl).toBeTruthy();
    expect(mcpDraftProblems({ ...d, serverUrl: 'ftp://x.io' }).serverUrl).toBeTruthy();
    expect(mcpDraftProblems({ ...d, scope: 'selected', orgs: [] }).orgs).toBeTruthy();
    expect(mcpDraftProblems(d)).toEqual({});
  });

  it('offers the expiries that fit under the maximum, and the maximum itself', () => {
    expect(personalExpiryChoices(30)).toEqual([1, 7, 30]);
    expect(personalExpiryChoices(10)).toEqual([1, 7, 10]);
    expect(personalExpiryChoices(1)).toEqual([1]);
  });
});
