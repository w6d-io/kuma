import { describe, it, expect } from 'vitest';
import { orgFormProblem, tenantFrom } from './orgTenant';

describe('tenantFrom', () => {
  it('derives a namespace-shaped label, as jinbe does', () => {
    expect(tenantFrom('Acme Corp')).toBe('acme-corp');
    expect(tenantFrom('  Société Générale  ')).toBe('societe-generale');
    expect(tenantFrom('***')).toBe('');
    expect(tenantFrom('a'.repeat(80))).toHaveLength(63);
  });
});

describe('orgFormProblem', () => {
  it('needs a name, and a tenant it can derive or is given', () => {
    expect(orgFormProblem('', '')).toMatch(/name/);
    expect(orgFormProblem('***', '')).toMatch(/tenant/);
    expect(orgFormProblem('***', 'stars')).toBeNull();
    expect(orgFormProblem('Acme', 'Not Valid')).toMatch(/lowercase/);
    expect(orgFormProblem('Acme', '')).toBeNull();
  });
});
