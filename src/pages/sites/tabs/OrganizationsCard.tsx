import { Button, Callout, Card, Field, FormGrid, I, Select, Switch } from '../../../components/ui';
import { orgRoleName } from '../../../lib/sites/access';
import { DEFAULT_OWNER_ROLE, organizationsOn, organizationTemplateAdds, usesOrganizations, withOrganizationTemplate } from '../../../lib/sites/templates';
import type { Site } from '../../../lib/sites/types';

/**
 * The site's Organizations switch (`organizations`): a way for many people to share the same objects
 * in the site's backend. On, the site's org roles decide what each member of an organization may do,
 * and the owners of an organization hold `ownerRole` in it. Off, every org feature is refused at
 * review. Turning it on offers the template: the organization gate, an /orgs/:orgId/… route and two
 * org roles.
 */
export function OrganizationsCard({ site, readOnly, set }: { site: Site; readOnly: boolean; set: (fn: (s: Site) => Site) => void }) {
  const on = organizationsOn(site);
  const used = usesOrganizations(site);
  const adds = organizationTemplateAdds(site);
  // The site's org roles, by the name owners would hold (`<site>-admin` → admin).
  const orgRoles = Object.keys(site.groups.orgGrantable).filter((g) => g.startsWith(`${site.name}-`)).map((g) => orgRoleName(site.name, g));
  const owner = site.organizations?.ownerRole ?? DEFAULT_OWNER_ROLE;

  // Off is said explicitly: jinbe reads an intent with no `organizations` as one made before the
  // switch existed, and renders it ON when it uses org features.
  const turn = (next: boolean) => set((s) => ({ ...s, organizations: next ? { ...s.organizations, enabled: true } : { enabled: false } }));

  return (
    <Card title="Organizations" sub="Let people share the same objects in this site, per organization. Each member gets an org role; the owners hold the owner role.">
      <FormGrid>
        <Field label="Organizations on this site" inline hint={on ? 'Org routes, org roles and the organizations list work.' : 'Off: org routes, org roles, the organizations list and org sign-up are refused.'}>
          <Switch on={on} disabled={readOnly} label="Organizations" onChange={turn} />
        </Field>
        {on && (
          <Field
            label="Owners hold"
            hint={orgRoles.includes(owner) ? `The org role an organization's owners hold here: ${site.name}:${owner}.` : undefined}
            warning={orgRoles.includes(owner) ? undefined : `This site has no org role ${site.name}:${owner}: owners hold nothing here until it exists.`}
          >
            <Select
              value={owner}
              disabled={readOnly}
              onChange={(e) => set((s) => ({ ...s, organizations: { enabled: true, ...(e.target.value === DEFAULT_OWNER_ROLE ? {} : { ownerRole: e.target.value }) } }))}
            >
              {[...new Set([owner, ...orgRoles])].map((r) => <option key={r} value={r}>{site.name}:{r}</option>)}
            </Select>
          </Field>
        )}
      </FormGrid>
      {on && adds.length > 0 && !readOnly && (
        <Callout
          tone="info"
          icon={I.sparkle}
          title="Start from the template"
          className="mt-12"
          actions={<Button size="sm" onClick={() => set(withOrganizationTemplate)}>Add the template</Button>}
        >
          Adds {adds.join(', ')}. Then put the service&apos;s routes under /orgs/:orgId/: a person gets through only with a role in that organization, a key only for its own.
        </Callout>
      )}
      {!on && used && (
        <Callout
          tone="warning"
          icon={I.alert}
          title="This site uses organization features"
          className="mt-12"
          actions={!readOnly && <Button size="sm" onClick={() => turn(true)}>Turn on</Button>}
        >
          It has org routes, org roles, organizations or an org sign-up. Publishing is refused until organizations are on, or those are removed.
        </Callout>
      )}
    </Card>
  );
}
