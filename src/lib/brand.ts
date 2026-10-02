/**
 * The deployment's own brand (LOGO_URL, LOGO_DARK_URL, LOGO_SMALL_URL, FAVICON_URL, APP_NAME,
 * substituted into index.html at container start like API_BASE): a full logo for the rail and the
 * screens shown before it, a dark-theme variant of it, a small square one for the collapsed rail, the
 * phone bar and the tab icon, and a name for the tab title. Unset, the console keeps its own "K" tile.
 *
 * Only https:// or a path on this origin: a logo is fetched by every visitor's browser, so an
 * http:// one is mixed content, and a javascript: or data: one is not an image anybody chose to host.
 */

export interface Brand {
  full: string | null;
  /** The full logo drawn for the dark theme; without it the full logo sits on a neutral plate. */
  fullDark?: string | null;
  small: string | null;
  favicon: string | null;
  /** "<name> — Access console" in the tab; the console's own name beside its tile. */
  appName?: string | null;
}

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

/** A configured name: trimmed, at most 60 characters; null when empty or never substituted. */
export function appName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v && !v.startsWith('${') ? v.slice(0, 60) : null;
}

export function readBrand(w: Record<string, unknown> = window as unknown as Record<string, unknown>): Brand {
  const full = logoUrl(w.__LOGO_URL__);
  const small = logoUrl(w.__LOGO_SMALL_URL__);
  return {
    full,
    // A dark variant without the logo it varies is not a logo to show.
    fullDark: full ? logoUrl(w.__LOGO_DARK_URL__) : null,
    small,
    favicon: logoUrl(w.__FAVICON_URL__) ?? small,
    appName: appName(w.__APP_NAME__),
  };
}

/** The tab title: "<APP_NAME> — Access console" when a name is configured; the page's own otherwise. */
export function applyTitle(brand: Brand, doc: Document = document): void {
  if (brand.appName) doc.title = `${brand.appName} — Access console`;
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
