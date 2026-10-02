import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from './ui/testing';
import { BrandMark, ScreenBrand } from './BrandMark';

const none = { full: null, small: null, favicon: null };
const both = { full: 'https://example.com/full.svg', small: 'https://example.com/small.svg', favicon: 'https://example.com/small.svg' };
const text = () => document.body.textContent ?? '';
const imgs = (sel: string) => [...document.querySelectorAll<HTMLImageElement>(`img${sel}`)];

afterEach(cleanup);

describe('BrandMark', () => {
  it('without a logo keeps the console tile, named by APP_NAME when set', () => {
    render(<BrandMark brand={none} />);
    expect(document.querySelector('.logo-mark')?.textContent).toBe('K');
    expect(text()).toContain('KumaAccess console');
    cleanup();
    render(<BrandMark brand={{ ...none, appName: 'Acme' }} />);
    expect(text()).toContain('AcmeAccess console');
  });
  it('the full logo on a plate, its box sized before it loads, "Access console" under it, the small one for the collapsed rail', () => {
    render(<BrandMark brand={both} />);
    const [full] = imgs('.logo-full');
    expect(full.getAttribute('src')).toBe(both.full);
    expect(full.classList.contains('plated')).toBe(true);
    expect(full.getAttribute('height')).toBe('28');
    expect(document.querySelector('.logo-collapsed img.logo-small')?.getAttribute('src')).toBe(both.small);
    expect(text()).toBe('Access console');
    expect(document.querySelector('.logo-mark')).toBeNull();
  });
  it('a dark variant replaces the plate: one image per theme', () => {
    render(<BrandMark brand={{ ...both, fullDark: 'https://example.com/full-dark.svg' }} />);
    expect(imgs('.logo-full.only-light')[0].getAttribute('src')).toBe(both.full);
    expect(imgs('.logo-full.only-dark')[0].getAttribute('src')).toBe('https://example.com/full-dark.svg');
    expect(imgs('.plated')).toHaveLength(0);
  });
  it('the phone sheet shows the square mark', () => {
    render(<BrandMark compact brand={both} />);
    expect(imgs('.logo-full')).toHaveLength(0);
    expect(imgs('.logo-small')[0].getAttribute('src')).toBe(both.small);
  });
  it('a logo that fails to load falls back to the tile', () => {
    render(<BrandMark brand={both} />);
    act(() => { imgs('.logo-full')[0].dispatchEvent(new Event('error')); });
    act(() => { imgs('.logo-small')[0].dispatchEvent(new Event('error')); });
    expect(imgs('.logo-full')).toHaveLength(0);
    expect(document.querySelector('.logo-mark')?.textContent).toBe('K');
  });
});

describe('ScreenBrand', () => {
  it('the organisation screens carry the full logo, or the mark and the name', () => {
    render(<ScreenBrand brand={both} />);
    expect(imgs('.logo-full')[0].getAttribute('src')).toBe(both.full);
    cleanup();
    render(<ScreenBrand brand={{ ...none, appName: 'Acme' }} />);
    expect(text()).toBe('KAcmeAccess console');
  });
});
