import { describe, it, expect } from 'vitest';

// useRbacData → client reads `window.__API_BASE__` at module load; stub
// before the import so the suite can run under the node environment
// without dragging in jsdom.
(globalThis as unknown as { window: Record<string, unknown> }).window = {};

const { kratosToUser } = await import('../useRbacData');
type KratosIdentity = import('../client').KratosIdentity;

// Reusable Kratos identity skeleton — the mapper only reads a handful
// of fields, so omitting the rest is fine; the helper just keeps the
// individual cases readable.
function ident(overrides: Partial<KratosIdentity> = {}): KratosIdentity {
  return {
    id: 'id-1',
    schema_id: 'default',
    state: 'active',
    state_changed_at: '2026-01-01T00:00:00Z',
    traits: { email: 'a@b.test' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('kratosToUser — multi-org & picture mapping', () => {
  it('returns organizations: [] for a legacy identity without metadata_admin.organizations', () => {
    const u = kratosToUser(ident());
    expect(u.organizations).toEqual([]);
    expect(u.organizationId).toBeNull();
    expect(u.picture).toBeNull();
  });

  it('preserves organizationId when only the legacy organization_id is set', () => {
    const u = kratosToUser(ident({ organization_id: 'org-legacy' }));
    expect(u.organizationId).toBe('org-legacy');
    // Legacy single-org pointer does NOT auto-promote into the multi-org
    // list — that contract is owned by the backend (jinbe is responsible
    // for emitting metadata_admin.organizations). Mapper stays passive.
    expect(u.organizations).toEqual([]);
  });

  it('populates organizations from metadata_admin.organizations', () => {
    const u = kratosToUser(ident({
      metadata_admin: {
        groups: ['admins'],
        organizations: ['8f3a1c2e-1111-2222-3333-444455556666', '9a4b2d3f-aaaa-bbbb-cccc-ddddeeeeffff'],
      },
    }));
    expect(u.organizations).toEqual([
      '8f3a1c2e-1111-2222-3333-444455556666',
      '9a4b2d3f-aaaa-bbbb-cccc-ddddeeeeffff',
    ]);
    expect(u.groups).toEqual(['admins']);
  });

  it('coerces non-array metadata_admin.organizations to an empty list (fail-closed)', () => {
    // Defensive: if jinbe ever ships a bad shape, the UI shouldn't crash
    // mapping `.map` over a non-iterable. Empty list is the safe default.
    const u = kratosToUser(ident({
      metadata_admin: {
        // @ts-expect-error -- intentionally wrong shape for the test
        organizations: 'not-an-array',
      },
    }));
    expect(u.organizations).toEqual([]);
  });

  it('surfaces traits.picture as user.picture', () => {
    const u = kratosToUser(ident({
      traits: { email: 'a@b.test', name: 'Anne B', picture: 'https://cdn.example/a.png' },
    }));
    expect(u.picture).toBe('https://cdn.example/a.png');
    expect(u.name).toBe('Anne B');
  });

  it('treats webauthn.config.user_handle-only credentials as MFA off (regression)', () => {
    const k = ident({
      // @ts-expect-error -- include_credential side-shape, not in the
      // KratosIdentity type but the mapper supports it.
      credentials: {
        webauthn: { config: { user_handle: 'abc' } },
      },
    });
    const u = kratosToUser(k);
    // Kratos auto-creates an empty webauthn credential block for any
    // identity whose schema declares the identifier — presence of the
    // credential key alone is NOT enrolment. The mapper must reflect
    // that or the privilege-escalation gate becomes a false positive.
    expect(u.mfa).toBe(false);
  });
});
