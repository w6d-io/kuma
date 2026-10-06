import type { BundleImportResult } from '../../api/client';
import { I, Button, Callout, Card, CodeView } from '../../components/ui';

/** What a snapshot holds and what it does not — so nobody counts on it for what it cannot give back. */
export function SnapshotContents() {
  return (
    <Card title="What a snapshot holds" sub="The same file in S3, in a download and in the import history.">
      <div className="grid g2">
        <div>
          <div className="fw-medium mb-4">In it</div>
          <ul className="small leading-relaxed m-0">
            <li>Services, groups, roles (with org roles) and route maps</li>
            <li>People’s organization roles and direct grants</li>
            <li>Which organizations reach which sites</li>
            <li>Site intents and every saved version</li>
            <li>Platform settings: sign-in protection, two-step sign-in per group, AI assistants (MCP), sign-in methods</li>
            <li>Organizations, sign-up organizations and domain claims</li>
            <li>Descriptions of services and groups</li>
          </ul>
        </div>
        <div>
          <div className="fw-medium mb-4">Not in it</div>
          <ul className="small leading-relaxed m-0">
            <li>Accounts (people’s identities, passwords, second factors) and OAuth clients: they need a backup of the identity database</li>
            <li>Gateway rules: built-in ones come from the running release, site ones are published from the sites</li>
            <li>What the release defines in code: jinbe’s own roles and the staff groups</li>
            <li>Site drafts, deleted sites, API keys and the audit trail</li>
          </ul>
          <p className="small muted leading-relaxed mb-0">A restore never deletes an organization: one created after the snapshot keeps its members, roles, grants and domains.</p>
        </div>
      </div>
    </Card>
  );
}

/** What the last restore did: counts, sites written back and published again, and what it left out. */
export function RestoreResult({ title, result, onDismiss }: { title: string; result: BundleImportResult; onDismiss: () => void }) {
  const r = result.rbac;
  const failed = result.sites?.failed ?? [];
  const restoredSites = result.stores?.sites?.restored ?? [];
  return (
    <Callout
      tone={failed.length ? 'warning' : 'success'}
      icon={failed.length ? I.alert : I.check}
      title={title}
      actions={<Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>}
    >
      <div className="small col gap-4">
        <div>{r.services} services · {r.groups} groups · {r.roles} roles · {r.routeMaps} route maps</div>
        {restoredSites.length > 0 && <div>Sites written back: <span className="mono">{restoredSites.join(', ')}</span></div>}
        {result.sites && <div>{result.sites.published.length} applied site{result.sites.published.length === 1 ? '' : 's'} published again.</div>}
        {failed.map((f) => (
          <div key={f.site}>Could not publish <span className="mono">{f.site}</span> again: {f.error}. Open the site and apply it.</div>
        ))}
        {(result.notes ?? []).map((n) => <div key={n} className="muted">{n}</div>)}
      </div>
    </Callout>
  );
}

/** S3 is off: downloads and restores from a file still work; this is how to keep snapshots in S3. */
export function BackupSetup() {
  return (
    <Card title="Scheduled backups to S3 are off" sub="Download a snapshot and restore from a file work without it.">
      <p className="small muted leading-relaxed mt-0">
        With S3 on, jinbe keeps a snapshot every day, lists them here, and a fresh install restores the latest one. Set in the auth Helm values:
      </p>
      <CodeView title="values.yaml" language="yaml" code={`backup:
  enabled: true
  s3:
    bucket: your-auth-backup-bucket
    region: eu-west-3
jinbe:
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/auth-backup-role`} />
      <p className="small muted leading-relaxed mb-0">
        The role needs <span className="mono">s3:PutObject</span>, <span className="mono">s3:GetObject</span> and{' '}
        <span className="mono">s3:ListBucket</span> on the bucket.
      </p>
    </Card>
  );
}
