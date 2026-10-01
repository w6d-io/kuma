import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, type } from '../../../components/ui/testing';
import { HANDLER_FIELDS } from '../../../lib/sites/handlerFields';
import { HandlerFieldEditor } from './HandlerFieldEditor';

// jinbe sets every gate's Cookie header itself (the platform session cookie stripped) and overrides
// a site's: the identity headers editor refuses the key instead of letting it be replaced silently.

const field = HANDLER_FIELDS.mutators.header.find((f) => f.key === 'headers')!;
const text = () => document.body.textContent ?? '';
const add = () => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement;
afterEach(cleanup);

describe('identity headers editor', () => {
  it('refuses Cookie in any case, inline, with Add off', () => {
    const onChange = vi.fn();
    render(<HandlerFieldEditor field={field} config={{}} onChange={onChange} idBase="t" />);
    type(document.querySelector<HTMLInputElement>('input[aria-label="New name"]')!, 'cOOkie');
    expect(text()).toContain('Cookie is reserved: the gateway removes the platform session cookie before it reaches the app');
    expect(add().disabled).toBe(true);
    type(document.querySelector<HTMLInputElement>('input[aria-label="New name"]')!, 'X-Org');
    expect(text()).not.toContain('Cookie is reserved');
    expect(add().disabled).toBe(false);
  });
  it('says so for a Cookie already set (Expert JSON, the API)', () => {
    render(<HandlerFieldEditor field={field} config={{ headers: { Cookie: 'a=b' } }} onChange={() => {}} idBase="t" />);
    expect(text()).toContain('Cookie is reserved');
  });
});
