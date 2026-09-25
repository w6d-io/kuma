import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useSession, useUserIdentity } from '../../api/hooks';
import { useOrgCatalog } from '../../api/orgCatalog';
import { Chip } from '../../components/ui/Primitives';
import { OrgPicker } from '../../components/OrgPicker';
import { ApiErrorState } from '../../components/ApiErrorState';
import { useApplyChange } from '../../hooks/useApplyChange';
import { membershipsOf } from '../../api/transforms';
import { orgLabel } from '../../lib/orgOptions';
import { PRIVILEGED_MUTATION, permits } from '../../policy/model';
import type { User } from '../../api/types';

// Multi-organization membership editor (Users drawer · Organizations tab).
//
// A user's EFFECTIVE membership = the native primary `organization_id` UNION the
// additional list. jinbe OWNS that set now and answers it as `organizations`;
// `metadata_admin.organizations` is the write path and the fallback, no longer
// the truth. Both halves are edited against EXISTING endpoints:
//   • primary    → PATCH /admin/users/:id/organization  (native, UUID-checked)
//   • additional → PATCH /admin/users/:id/metadata       (merge; refuses groups)
// Organizations are picked by NAME from the catalogue the caller may see
// (useOrgCatalog) — never typed as raw ids.
//
// Editors seed from the AUTHORITATIVE identity (useUserIdentity), never the
// directory row: a search-hit row omits the multi-org list, and a merge-write
// built on that false-empty base would wipe real memberships. Membership grants
// NO permission on its own (permissions come from groups, gated separately) —
// but it is a sensitive tenant-scoping action, so the additional-org write
// mirrors the backend gate as defence in depth.
export function UserOrgsTab({ user }: { user: User }) {
  const { apiSetUserOrganization, apiSetUserOrganizations } = useApp();
  const applyChange = useApplyChange();
  const { data: session } = useSession();
  // Editing somebody's organisations is gated on the permission the mutation checks. A role NAME
  // this model does not define greyed the whole tab for the very people who may change it.
  const mayEditMemberships = permits(session?.permissions, PRIVILEGED_MUTATION);

  const identityQ = useUserIdentity(user.id);
  const identity = identityQ.data;
  const { orgs: catalog } = useOrgCatalog();
  // The starting point of an EDIT, which is why the source matters more here than anywhere else:
  // this screen saves what it is showing. jinbe answers `organizations` from the records it owns —
  // the effective set, primary included — so the additional list is that set minus the primary.
  // Only when the field is absent (a backend that does not own membership) does what was written on
  // the identity stand in. Seeding from the identity while the truth lived elsewhere would have
  // shown an empty list to somebody who belongs to three, and saving it would have made that true.
  const baselineAdditional = useMemo(() => {
    if (!identity) return [];
    const primaryId = identity.organization_id ?? "";
    return membershipsOf(identity).filter(o => o && o !== primaryId);
  }, [identity]);

  const [primary, setPrimary] = useState("");
  const [additional, setAdditional] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);

  // Seed once, from the source of truth, when it lands. The `seeded` guard keeps
  // a post-save refetch (or a realtime invalidation) from wiping in-progress edits.
  useEffect(() => {
    if (!identity || seeded) return;
    setPrimary(identity.organization_id ?? "");
    setAdditional(baselineAdditional);
    setSeeded(true);
  }, [identity, baselineAdditional, seeded]);

  if (identityQ.isError) {
    return <ApiErrorState compact what="this person's organizations" error={identityQ.error} onRetry={() => identityQ.refetch()} />;
  }
  if (identityQ.isLoading || !seeded) {
    return (
      <div className="panel" style={{ padding: 24, textAlign: "center" }}>
        <span className="small muted">Loading organizations…</span>
      </div>
    );
  }

  const name = (id: string) => orgLabel(id, catalog);
  const baselinePrimary = identity?.organization_id ?? "";
  const remove = (o: string) => setAdditional(prev => prev.filter(x => x !== o));
  const add = (o: string) => { if (o) setAdditional(prev => (prev.includes(o) ? prev : [...prev, o])); };

  const listed = additional.filter(o => o && o !== primary).sort((a, b) => name(a).localeCompare(name(b)));
  const effective = Array.from(new Set([...(primary ? [primary] : []), ...additional]));

  const primaryChanged = primary !== baselinePrimary;
  const additionalChanged =
    JSON.stringify([...additional].sort()) !== JSON.stringify([...baselineAdditional].sort());

  const savePrimary = () =>
    applyChange("organization", user.email, () => apiSetUserOrganization(user.id, primary || undefined));
  const saveAdditional = () => {
    if (!mayEditMemberships) return;
    applyChange("organizations", user.email, () => apiSetUserOrganizations(user.id, additional));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="small muted">
        A member belongs to their primary organization plus any additional ones. Membership places
        them in an organization; it grants nothing on its own — access comes from their groups.
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <div className="input-label">Member of</div>
        {effective.length === 0
          ? <span className="small muted">— no organization —</span>
          : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {effective.map(o => (
                <Chip key={o} mono={false} tone={o === primary ? "accent" : ""} title={o}>
                  {name(o)}{o === primary ? " · primary" : ""}
                </Chip>
              ))}
            </div>
          )}
      </div>

      <div>
        <label className="input-label">Primary organization</label>
        <div className="row" style={{ gap: 8 }}>
          <OrgPicker
            value={primary}
            onChange={setPrimary}
            noneLabel="No primary organization"
            ariaLabel="Primary organization"
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={savePrimary} disabled={!primaryChanged}>Save primary</button>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          The organization whose org admins manage this person.
        </div>
      </div>

      <div>
        <label className="input-label">Additional organizations</label>
        {listed.length === 0
          ? (
            <div className="panel" style={{ padding: 14, marginTop: 6 }}>
              <span className="small muted">None.</span>
            </div>
          )
          : (
            <div className="panel" style={{ padding: 0, marginTop: 6 }}>
              {listed.map((o, i) => (
                <div
                  key={o}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                    borderBottom: i < listed.length - 1 ? "1px solid var(--line)" : "none",
                  }}
                  title={o}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{name(o)}</span>
                  <button className="btn ghost sm" disabled={!mayEditMemberships} onClick={() => remove(o)}>Remove</button>
                </div>
              ))}
            </div>
          )}

        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <OrgPicker
            value=""
            onChange={add}
            exclude={[primary, ...additional]}
            placeholder="Add an organization…"
            ariaLabel="Add an organization"
            disabled={!mayEditMemberships}
            style={{ flex: 1 }}
          />
        </div>

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <span className="small muted">
            {mayEditMemberships
              ? "Replaces the additional organizations; the primary one is unaffected."
              : "Changing additional organizations needs permission to manage members."}
          </span>
          <button
            className="btn primary"
            onClick={saveAdditional}
            disabled={!mayEditMemberships || !additionalChanged}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
