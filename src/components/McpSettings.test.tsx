import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render } from './ui/testing';


const h = vi.hoisted(() => ({ data: undefined as unknown, mutate: vi.fn(), toast: vi.fn() }));
vi.mock('../api/hooks', () => ({
  useMcpSettings: () => ({ data: h.data, isError: false }),
  useSetMcpSettings: () => ({ mutate: h.mutate, isPending: false }),
  useGroups: () => ({ data: [{ name: 'support', services: {} }, { name: 'developers', services: {} }] }),
}));
vi.mock('../contexts/AppContext', () => ({ useApp: () => ({ pushToast: h.toast }) }));

import { McpSettings } from './McpSettings';
import { fromMcpDraft, mcpDraftProblems, personalExpiryChoices, sameMcp, toMcpDraft } from '../lib/mcpSettings';

afterEach(() => { cleanup(); h.mutate.mockReset(); });

const settings = (over: Record<string, unknown> = {}) => ({ enabled: true, serverUrl: null, personalKeys: { maxDays: 30 }, allowedGroups: 'all', ...over });
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

  it('limits to some groups: needs at least one, then saves their names', () => {
    h.data = view();
    const { container } = render(<McpSettings />);
    expect(container.textContent).not.toContain('Organizations');
    click(byText(container, 'button', /^Only some$/));
    expect(container.textContent).toContain('Pick at least one group');
    expect((byText(container, 'button', /^Save$/) as HTMLButtonElement).disabled).toBe(true);
    click(byText(container, 'label', /^support$/));
    click(byText(container, 'button', /^Save$/));
    expect(h.mutate).toHaveBeenCalledWith(settings({ allowedGroups: ['support'] }), expect.anything());
  });

  it('keeps a saved group the list no longer holds, so it can be unticked', () => {
    h.data = view({ allowedGroups: ['ops'] });
    const { container } = render(<McpSettings />);
    expect(byText(container, 'label', /^ops$/)).toBeTruthy();
  });
});

describe('lib/mcpSettings', () => {
  it('round-trips a document and compares group lists in any order', () => {
    const s = { enabled: false, serverUrl: 'https://m.example.com', personalKeys: { maxDays: 7 }, allowedGroups: ['support', 'developers'] };
    expect(fromMcpDraft(toMcpDraft(s))).toEqual({ ...s, allowedGroups: ['developers', 'support'] });
    expect(sameMcp(s, { ...s, allowedGroups: ['developers', 'support'] })).toBe(true);
    expect(fromMcpDraft({ ...toMcpDraft(s), serverUrl: '  ' }).serverUrl).toBeNull();
  });

  it('refuses a URL with credentials or another scheme, and an empty group selection', () => {
    const d = toMcpDraft({ enabled: true, serverUrl: null, personalKeys: { maxDays: 30 }, allowedGroups: 'all' });
    expect(mcpDraftProblems({ ...d, serverUrl: 'https://u:p@x.io' }).serverUrl).toBeTruthy();
    expect(mcpDraftProblems({ ...d, serverUrl: 'ftp://x.io' }).serverUrl).toBeTruthy();
    expect(mcpDraftProblems({ ...d, scope: 'selected', groups: [] }).groups).toBeTruthy();
    expect(mcpDraftProblems(d)).toEqual({});
  });

  it('offers the expiries that fit under the maximum, and the maximum itself', () => {
    expect(personalExpiryChoices(30)).toEqual([1, 7, 30]);
    expect(personalExpiryChoices(10)).toEqual([1, 7, 10]);
    expect(personalExpiryChoices(1)).toEqual([1]);
  });

  it('offers browser sign-in only on a jinbe that has it, and saves it with the fields it does not edit', () => {
    h.data = view();
    const older = render(<McpSettings />);
    expect(older.container.querySelector('[aria-label="Allow sign-in with a browser (OAuth)"]')).toBeNull();
    cleanup();

    const oauth = { enabled: true, maxDays: 30, protectedActions: 'window', protectedActionsHours: 12 };
    h.data = view({ oauth });
    const { container } = render(<McpSettings />);
    const sw = container.querySelector<HTMLElement>('[aria-label="Allow sign-in with a browser (OAuth)"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    click(sw);
    expect(container.textContent).toContain('Assistants need a personal key');
    click(byText(container, 'button', /^Save$/));
    expect(h.mutate).toHaveBeenCalledWith(settings({ oauth: { ...oauth, enabled: false } }), expect.anything());
  });

  it('sets how long a browser sign-in lives and how long protected actions stay allowed', () => {
    const oauth = { enabled: true, maxDays: 30, protectedActions: 'window', protectedActionsHours: 12 };
    h.data = view({ oauth });
    const { container } = render(<McpSettings />);
    const selectIn = (label: RegExp) => byText(container, '.field', label).querySelector('select')!;
    const days = selectIn(/^Longest sign-in/);
    const hours = selectIn(/^Protected actions after sign-in/);
    expect(hours.value).toBe('12');
    act(() => { days.value = '7'; days.dispatchEvent(new Event('change', { bubbles: true })); });
    act(() => { hours.value = '0'; hours.dispatchEvent(new Event('change', { bubbles: true })); });
    click(byText(container, 'button', /^Save$/));
    expect(h.mutate).toHaveBeenCalledWith(settings({ oauth: { enabled: true, maxDays: 7, protectedActions: 'off', protectedActionsHours: 12 } }), expect.anything());
  });

  it('never sends a browser sign-in setting to a jinbe without one', () => {
    const d = toMcpDraft(settings() as never);
    expect(d.browserSignIn).toBeNull();
    expect('oauth' in fromMcpDraft({ ...d, enabled: false })).toBe(false);
  });
});
