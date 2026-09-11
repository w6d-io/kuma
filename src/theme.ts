/**
 * The reader's choice of theme, applied before anything renders.
 *
 * It has to be applied outside React, and early. The organisation chooser renders OUTSIDE the app
 * shell — a session that has not said which organisation it acts in has no token the API would
 * accept, so the console is not mounted behind the question. The effect that used to stamp the theme
 * lived inside the shell's provider, so it never ran for that screen: the chooser was decided by the
 * machine's setting while the console was decided by a stored one, and the two could not agree
 * because only one of them was ever asked.
 *
 * Three states, because "follow the machine" is a real answer and not the absence of one:
 * `system` removes the attribute so `prefers-color-scheme` keeps deciding — including when the
 * machine's setting changes while the page is open — and the other two override it in both
 * directions.
 */

export type Theme = 'system' | 'light' | 'dark';

/** Cycle order. `system` first: it is the default, and the only one that keeps following the machine. */
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/**
 * Shared with every screen served from this origin.
 *
 * The console is mounted under `/admin` on the same host as the sign-in screens, so one key is all
 * it takes for a choice made in one to be honoured by the other.
 */
const STORAGE_KEY = 'strada.theme';

const LABELS: Record<Theme, string> = {
  system: 'Theme: following the system — click for light',
  light: 'Theme: light — click for dark',
  dark: 'Theme: dark — click to follow the system',
};

export function storedTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return saved && THEMES.includes(saved) ? saved : 'system';
  } catch {
    // Private browsing refuses to read. This visit follows the machine, which is the default anyway.
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Losing the preference is not worth failing a click over, and it still applies for this visit.
  }
}

/** The next state in the cycle. Separate from applying it so the label can name where a click goes. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

export function themeLabel(theme: Theme): string {
  return LABELS[theme];
}

/** Whether the page is dark right now — chosen, or inherited from the machine. */
export function isDark(): boolean {
  const chosen = document.documentElement.getAttribute('data-theme');
  if (chosen) return chosen === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * Stamp the stored choice on the document.
 *
 * Called from the entry point before the first render, so no screen — inside the shell or outside
 * it — ever paints under a theme nobody chose.
 */
export function initTheme(): Theme {
  const theme = storedTheme();
  applyTheme(theme);
  return theme;
}
