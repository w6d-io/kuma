// The labels of the authoritative risk flags an audit/v1 event carries (`flags`).
export const RISK_FLAG_LABEL: Record<string, string> = {
  grants_super_admin: 'grants super-admin',
  wildcard_permission: 'grants wildcard (*)',
  opened_to_public: 'opened to the public',
  auth_disabled: 'authentication disabled',
};
