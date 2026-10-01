import { describe, it, expect } from 'vitest';
import { NAV } from '../nav';
import { isCatalogPermission } from './catalog';

// kuma CI (authz-v2-design §3.5): every permission the console asks is in the catalogue snapshot, and
// no gate asks a wildcard or a retired name. The types already refuse an unknown name at holds() and
// in the rail; this reads the sources too, so a string compared by hand cannot slip past.

const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('what the console asks', () => {
  it('the rail asks catalogue names only', () => {
    for (const item of NAV) for (const p of item.perms) expect(isCatalogPermission(p), `${item.id}: ${p}`).toBe(true);
  });

  it('every holds / holdsIn / orgsWhere asks a catalogue name', () => {
    const asked = new Set<string>();
    for (const text of Object.values(sources)) {
      for (const m of text.matchAll(/\b(?:holds|holdsIn|orgsWhere)\([^)]*?'([a-z][a-z0-9_.-]*:[a-z][a-z0-9_-]*)'\)/g)) asked.add(m[1]);
    }
    expect(asked.size).toBeGreaterThan(20);
    for (const p of asked) expect(isCatalogPermission(p), p).toBe(true);
  });

  it('no source gates on a retired name or a wildcard', () => {
    const retired = /'(?:admin(?:\.[a-z]+)?:(?:read|write)|org:(?:read|write|delete)|org\.admins:write)'|PRIVILEGED_MUTATION|\bpermits\(|\bmayUse\(/;
    const offenders = Object.entries(sources).filter(([, text]) => retired.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('the gates themselves know no wildcard', () => {
    for (const file of ['policy/model.ts', 'nav.tsx', 'hooks/useMyOrg.ts', 'lib/twoFactor.ts']) {
      const text = Object.entries(sources).find(([path]) => path.endsWith(`/${file}`) || path === `./${file.split('/').pop()}`)?.[1];
      expect(text, file).toBeDefined();
      expect(text!.includes("'*'"), file).toBe(false);
    }
  });
});
