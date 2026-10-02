/**
 * The deployment's own logo (LOGO_URL, LOGO_SMALL_URL, FAVICON_URL, substituted into index.html at
 * container start like API_BASE): a full logo for the rail, a small square one for the collapsed rail,
 * the phone sheet and the tab icon. Unset, the console keeps its own "K" tile.
 *
 * Only https:// or a path on this origin: a logo is fetched by every visitor's browser, so an
 * http:// one is mixed content, and a javascript: or data: one is not an image anybody chose to host.
 */

export interface Brand { full: string | null; small: string | null; favicon: string | null }

/** A usable logo address, or null: empty, never substituted ("${LOGO_URL}"), or not https / same-origin. */
export function logoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.startsWith('${')) return null;
  if (/^https:\/\/[^/\s]+/i.test(v)) return v;
  // Relative to this origin: "/brand/logo.svg", "./logo.svg", "logo.svg" — never "//host" (another origin).
  if (v.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  return v;
}

export function readBrand(w: Record<string, unknown> = window as unknown as Record<string, unknown>): Brand {
  const full = logoUrl(w.__LOGO_URL__);
  const small = logoUrl(w.__LOGO_SMALL_URL__);
  return { full, small, favicon: logoUrl(w.__FAVICON_URL__) ?? small };
}

/** Point the tab icon and the home-screen icon at the deployment's logo, when it has one. */
export function applyFavicon(brand: Brand, doc: Document = document): void {
  if (!brand.favicon) return;
  for (const rel of ['icon', 'apple-touch-icon']) {
    let link = doc.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = doc.createElement('link');
      link.rel = rel;
      doc.head.appendChild(link);
    }
    link.removeAttribute('type');
    link.href = brand.favicon;
  }
}
