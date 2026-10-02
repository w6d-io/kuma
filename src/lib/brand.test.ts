import { describe, expect, it } from 'vitest';
import { applyFavicon, logoUrl, readBrand } from './brand';

describe('logoUrl', () => {
  it('takes https and same-origin paths', () => {
    expect(logoUrl('https://cdn.example.com/logo.svg')).toBe('https://cdn.example.com/logo.svg');
    expect(logoUrl(' /brand/logo.png ')).toBe('/brand/logo.png');
    expect(logoUrl('./logo.svg')).toBe('./logo.svg');
  });
  it('treats empty and never-substituted values as unset', () => {
    expect(logoUrl('')).toBeNull();
    expect(logoUrl('${LOGO_URL}')).toBeNull();
    expect(logoUrl(undefined)).toBeNull();
  });
  it('refuses http, another origin without a scheme, and non-image schemes', () => {
    for (const v of ['http://example.com/logo.svg', '//example.com/logo.svg', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>']) expect(logoUrl(v)).toBeNull();
  });
});

describe('readBrand', () => {
  it('the favicon defaults to the small logo', () => {
    expect(readBrand({ __LOGO_URL__: 'https://example.com/full.svg', __LOGO_SMALL_URL__: 'https://example.com/small.svg', __FAVICON_URL__: '${FAVICON_URL}' }))
      .toEqual({ full: 'https://example.com/full.svg', small: 'https://example.com/small.svg', favicon: 'https://example.com/small.svg' });
    expect(readBrand({ __LOGO_SMALL_URL__: '/s.svg', __FAVICON_URL__: '/f.ico' }).favicon).toBe('/f.ico');
  });
});

describe('applyFavicon', () => {
  it('points the tab and home-screen icons at the logo, and leaves them alone without one', () => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="./favicon.svg">';
    applyFavicon({ full: null, small: null, favicon: null });
    expect(document.head.querySelector('link[rel="icon"]')!.getAttribute('href')).toBe('./favicon.svg');
    applyFavicon({ full: null, small: 'https://example.com/s.png', favicon: 'https://example.com/s.png' });
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href).toBe('https://example.com/s.png');
    expect(document.head.querySelector('link[rel="icon"]')!.hasAttribute('type')).toBe(false);
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.href).toBe('https://example.com/s.png');
  });
});
