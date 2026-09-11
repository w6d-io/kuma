import { describe, it, expect, beforeEach, vi } from 'vitest';
import { THEMES, applyTheme, initTheme, isDark, nextTheme, storeTheme, storedTheme, themeLabel } from './theme';

// Three states, and the third one is the point: `system` is a real answer, not the absence of one.
// It has to leave the attribute OFF so `prefers-color-scheme` keeps deciding after the page loaded.

describe('the stored choice', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('follows the system when nothing was ever chosen', () => {
    expect(storedTheme()).toBe('system');
  });

  it('keeps a choice across visits', () => {
    storeTheme('dark');
    expect(storedTheme()).toBe('dark');
  });

  it('falls back to the system for a value it does not recognise', () => {
    localStorage.setItem('strada.theme', 'sepia');
    expect(storedTheme()).toBe('system');
  });

  it('follows the system when storage cannot be read at all', () => {
    // Private browsing throws rather than answering null.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(storedTheme()).toBe('system');
    getItem.mockRestore();
  });

  it('does not fail a click when storage cannot be written', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => storeTheme('dark')).not.toThrow();
    setItem.mockRestore();
  });
});

describe('applying it to the document', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('stamps an explicit choice, in both directions', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('removes the stamp for system, so the machine keeps deciding', () => {
    // Writing "system" would leave every media-query rule guarded on the attribute unmatched, and
    // the page would stop following a setting changed while it is open.
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('stamps the stored choice before anything renders', () => {
    storeTheme('light');
    expect(initTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('the cycle', () => {
  it('goes system → light → dark → system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('visits every state and comes back', () => {
    let theme = THEMES[0];
    const seen = [theme];
    for (let i = 0; i < THEMES.length; i += 1) {
      theme = nextTheme(theme);
      seen.push(theme);
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen[seen.length - 1]).toBe(THEMES[0]);
  });

  it('names where the click goes, not only where it is', () => {
    // A control that says "dark" tells you nothing about what pressing it does.
    expect(themeLabel('system')).toMatch(/light/i);
    expect(themeLabel('light')).toMatch(/dark/i);
    expect(themeLabel('dark')).toMatch(/system/i);
  });
});

describe('whether the page is dark right now', () => {
  beforeEach(() => document.documentElement.removeAttribute('data-theme'));

  it('answers from the explicit choice when there is one', () => {
    applyTheme('dark');
    expect(isDark()).toBe(true);
    applyTheme('light');
    expect(isDark()).toBe(false);
  });

  it('asks the machine when the choice is to follow it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }) as MediaQueryList);
    applyTheme('system');
    expect(isDark()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('answers light rather than throwing where the machine cannot be asked', () => {
    // jsdom ships no `matchMedia`, and neither do some embedded browsers. A page that threw here
    // would fail to render over a question that only chooses a colour.
    vi.stubGlobal('matchMedia', undefined);
    applyTheme('system');
    expect(isDark()).toBe(false);
    vi.unstubAllGlobals();
  });
});
