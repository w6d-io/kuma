import { Badge, ChecklistGroups, EmptyHint, Field, I, Input, RelativeTime, type ChecklistGroup } from '../../components/ui';
import { useSession, useUserIdentity } from '../../api/hooks';
import { useActorName } from '../../lib/audit/actorNames';
import { statusOf } from '../../lib/apiError';
import { expiryLabel, expiryState, groupByKind, scopeHint, SCOPE_KIND_LABEL, type ScopeEntry } from '../../lib/apiKeys';

/** Pieces the API-key screens share: the scope picker, and the expiry, creator and last-use cells. */

/** When a key stops working, in words, with a tone once it is close or past. */
export function ExpiryCell({ expiresAt }: { expiresAt: string | null | undefined }) {
  const state = expiryState(expiresAt);
  if (state === 'unknown') return <span className="small muted">—</span>;
  if (state === 'expired') return <Badge tone="danger" icon={I.clock} mono={false}>Expired</Badge>;
  if (state === 'soon') return <Badge tone="warning" icon={I.clock} mono={false} title={new Date(expiresAt!).toLocaleString()}>{expiryLabel(expiresAt)}</Badge>;
  return <span className="small muted nowrap" title={expiresAt ? new Date(expiresAt).toLocaleString() : undefined}>{expiryLabel(expiresAt)}</span>;
}

/**
 * Who created a key: jinbe stores their account id. "You" for your own; a name once the console has
 * one for that id (audit pages, a lookup); otherwise the id, shortened, whole on hover.
 */
export function CreatorCell({ id, at, email }: { id: string | null; at: string | null; email?: string | null }) {
  const { data: session } = useSession();
  const resolved = useActorName(id);
  const looked = useUserIdentity(id ?? undefined, false).data?.traits;
  const who = !id ? null
    : id === session?.identity_id ? 'you'
    : email ?? resolved?.email ?? resolved?.name ?? looked?.email ?? null;
  return (
    <div className="small">
      <div className="muted nowrap">{at ? <RelativeTime at={at} /> : '—'}</div>
      {id && (who
        ? <div className="muted">by {who}</div>
        : <div className="muted mono" title={id}>by {id.slice(0, 8)}…</div>)}
    </div>
  );
}

/** Last use, when jinbe says it; otherwise nothing is claimed. */
export function LastUsedCell({ at }: { at: string | null | undefined }) {
  if (at === undefined) return <span className="small muted">—</span>;
  if (at === null) return <span className="small muted">Never</span>;
  return <span className="small muted"><RelativeTime at={at} /></span>;
}

const KIND_HINT = {
  permission: 'One permission, on every site whose routes ask for it.',
  role: 'Everything a site role carries, as it changes.',
  group: 'Everything a group gives on these sites, as it changes.',
} as const;

/** The catalogue as the checklist's groups: permissions, site roles, groups — each with what it lets a program do. */
function scopeGroups(entries: readonly ScopeEntry[]): ChecklistGroup[] {
  return groupByKind(entries).map((g) => ({
    id: g.kind,
    label: SCOPE_KIND_LABEL[g.kind],
    hint: KIND_HINT[g.kind],
    options: g.entries.map((e) => ({ value: e.scope, label: <span className="mono">{e.scope}</span>, hint: scopeHint(e), search: `${e.scope} ${e.sites.join(' ')}` })),
  }));
}

/** Why the scopes are typed rather than ticked. */
function fallbackReason(error: unknown): string {
  const status = statusOf(error);
  if (status === 404) return 'This server does not list the scopes you can grant.';
  if (status === 403) return 'The scope list is for platform staff who create keys (orgs.keys:write).';
  return 'The scopes you can grant could not be read.';
}

/**
 * The scopes of a key: ticked from the catalogue jinbe offers (grouped by site), a quiet line while it
 * loads, and — only when no catalogue can be had — a text field, with the reason said.
 */
export function ScopeField({ entries, loading, error, value, onChange, text, onText, hint }: {
  entries: ScopeEntry[] | null;
  loading: boolean;
  /** Why the catalogue could not be had, when it could not. */
  error: unknown;
  value: string[];
  onChange: (next: string[]) => void;
  text: string;
  onText: (next: string) => void;
  hint?: string;
}) {
  if (entries) {
    return (
      <Field label="Scopes" required hint={hint ?? 'What the key may do on the sites serving this organization. Pick at least one.'}>
        {entries.length === 0
          ? <EmptyHint>Nothing to grant: no site serving this organization has a permission, role or group a key can hold.</EmptyHint>
          : <ChecklistGroups label="Scopes" groups={scopeGroups(entries)} value={value} onChange={onChange} searchAt={10} />}
      </Field>
    );
  }
  if (loading) return <Field label="Scopes" required><EmptyHint>Loading the scopes you can grant…</EmptyHint></Field>;
  return (
    <Field
      label="Scopes"
      required
      hint={`${fallbackReason(error)} Type them, separated by commas or spaces; if one is refused, the ones you may grant are listed here.`}
    >
      <Input mono value={text} placeholder="e.g. billing:read" onChange={(e) => onText(e.target.value)} />
    </Field>
  );
}
