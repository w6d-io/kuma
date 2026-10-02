import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from './ui/testing';
import { BrandMark } from './BrandMark';

const none = { full: null, small: null, favicon: null };
const both = { full: 'https://example.com/full.svg', small: 'https://example.com/small.svg', favicon: 'https://example.com/small.svg' };
const text = () => document.body.textContent ?? '';
const img = (cls: string) => document.querySelector<HTMLImageElement>(`img.${cls}`);

afterEach(cleanup);

describe('BrandMark', () => {
  it('without a logo keeps the console tile', () => {
    render(<BrandMark brand={none} />);
    expect(document.querySelector('.logo-mark')?.textContent).toBe('K');
    expect(text()).toContain('KumaAccess console');
  });
  it('the full logo with "Access console" under it, and the small one ready for the collapsed rail', () => {
    render(<BrandMark brand={both} />);
    expect(img('logo-full')?.getAttribute('src')).toBe(both.full);
    expect(document.querySelector('.logo-collapsed img.logo-small')?.getAttribute('src')).toBe(both.small);
    expect(text()).toContain('Access console');
    expect(text()).not.toContain('Kuma');
  });
  it('the phone sheet shows the small logo', () => {
    render(<BrandMark compact brand={both} />);
    expect(img('logo-full')).toBeNull();
    expect(img('logo-small')?.getAttribute('src')).toBe(both.small);
  });
  it('a logo that fails to load falls back to the tile', () => {
    render(<BrandMark brand={both} />);
    act(() => { img('logo-full')!.dispatchEvent(new Event('error')); });
    act(() => { img('logo-small')!.dispatchEvent(new Event('error')); });
    expect(img('logo-full')).toBeNull();
    expect(document.querySelector('.logo-mark')?.textContent).toBe('K');
    expect(text()).toContain('Kuma');
  });
});
