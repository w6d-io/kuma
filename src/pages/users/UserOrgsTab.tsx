import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useSession, useUserIdentity } from '../../api/hooks';
import { useOrgCatalog } from '../../api/orgCatalog';
import { Badge, Button, Card } from '../../components/ui';
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
      <Card pad="md" className="text-center">
        <span className="small muted">Loading organizations…</span>
      </Card>
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
    <div className="stack gap-16">
      <div className="small muted">
        A member belongs to their primary organization plus any additional ones. Membership places
        them in an organization; it grants nothing on its own — access comes from their groups.
      </div>

      <Card pad="md">
        <div className="input-label">Member of</div>
        {effective.length === 0
          ? <span className="small muted">— no organization —</span>
          : (
            <div className="row wrap gap-4 mt-4">
              {effective.map(o => (
                <Badge key={o} mono={false} tone={o === primary ? "accent" : "neutral"} title={o}>
                  {name(o)}{o === primary ? " · primary" : ""}
                </Badge>
              ))}
            </div>
          )}
      </Card>

      <div>
        <label className="input-label">Primary organization</label>
        <div className="row gap-8">
          <div className="flex-1">
            <OrgPicker
              value={primary}
              onChange={setPrimary}
              noneLabel="No primary organization"
              ariaLabel="Primary organization"
            />
          </div>
          <Button onClick={savePrimary} disabled={!primaryChanged}>Save primary</Button>
        </div>
        <div className="small muted mt-4">
          The organization whose org admins manage this person.
        </div>
      </div>

      <div>
        <label className="input-label">Additional organizations</label>
        {listed.length === 0
          ? (
            <Card pad="md" className="mt-8">
              <span className="small muted">None.</span>
            </Card>
          )
          : (
            <Card className="mt-8">
              {listed.map(o => (
                <div key={o} className="people-sep people-row row gap-12" title={o}>
                  <span className="flex-1 truncate">{name(o)}</span>
                  <Button variant="ghost" size="sm" disabled={!mayEditMemberships} onClick={() => remove(o)}>Remove</Button>
                </div>
              ))}
            </Card>
          )}

        <div className="row gap-8 mt-8">
          <div className="flex-1">
            <OrgPicker
              value=""
              onChange={add}
              exclude={[primary, ...additional]}
              placeholder="Add an organization…"
              ariaLabel="Add an organization"
              disabled={!mayEditMemberships}
            />
          </div>
        </div>

        <div className="row justify-between mt-12">
          <span className="small muted">
            {mayEditMemberships
              ? "Replaces the additional organizations; the primary one is unaffected."
              : "Changing additional organizations needs permission to manage members."}
          </span>
          <Button
            variant="primary"
            onClick={saveAdditional}
            disabled={!mayEditMemberships || !additionalChanged}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
