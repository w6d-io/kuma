import { useMemo, useState } from 'react';
import { ChecklistGroups, EmptyHint, Field, Input, Select, TwoFactorBadge, type ChecklistGroup } from '../ui';
import { useStepUpRules } from '../../api/twoFactor';
import { choiceKey, choiceOf, draftsFrom, grantLabel, type GrantDraft } from '../../lib/grants';
import { ExpiryPicker } from './ExpiryPicker';
import { useGrantOptions } from './useGrantOptions';

/**
 * Individual roles and permissions for ONE person, on the platform or inside one organization: a
 * service (jinbe or a site), then its roles — each showing what it carries — and its permissions by
 * resource, with the recent-2FA mark where one is needed. One optional reason and one optional expiry
 * cover everything picked. Choices survive switching service, and the count says how many in all.
 */
export function GrantPicker({ org, onChange }: {
  /** The organization the grants count in; absent: the platform. */
  org?: string;
  onChange: (drafts: GrantDraft[], valid: boolean) => void;
}) {
  const [service, setService] = useState('jinbe');
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState<{ expiresAt: string | null; invalid: boolean }>({ expiresAt: null, invalid: false });
  const options = useGrantOptions(service, org);
  const { ruleOf } = useStepUpRules();

  const emit = (keys: string[], why: string, exp: typeof expiry) => onChange(draftsFrom(keys, why, exp.expiresAt), !exp.invalid);

  const groups = useMemo((): ChecklistGroup[] => {
    const mark = (p: string) => (ruleOf(p, service) ? <TwoFactorBadge kind="recent" rule={ruleOf(p, service)!} /> : null);
    const out: ChecklistGroup[] = [];
    if (options.roles.length) {
      out.push({
        id: 'roles',
        label: 'Roles',
        hint: 'Everything the role carries, kept in step with it',
        options: options.roles.map((r) => ({
          value: choiceKey({ service, kind: 'role', name: r.name }),
          search: `${r.name} ${r.permissions.join(' ')}`,
          label: <span className="row wrap gap-4"><span className="mono">{r.name}</span>{r.permissions.some((p) => ruleOf(p, service)) && <TwoFactorBadge kind="recent" title="Carries a permission that needs a recent second factor" />}</span>,
          hint: r.permissions.length ? r.permissions.join(' · ') : 'carries nothing',
        })),
      });
    }
    const byResource = new Map<string, string[]>();
    for (const p of options.permissions) {
      const res = p.slice(0, p.lastIndexOf(':')) || 'other';
      byResource.set(res, [...(byResource.get(res) ?? []), p]);
    }
    for (const [res, perms] of byResource) {
      out.push({
        id: `perm:${res}`,
        label: res,
        options: perms.map((p) => ({
          value: choiceKey({ service, kind: 'permission', name: p }),
          search: `${p} ${options.labelOf(p) ?? ''}`,
          label: <span className="row wrap gap-4"><span className="mono">{p}</span>{mark(p)}</span>,
          hint: options.labelOf(p),
        })),
      });
    }
    return out;
  }, [options, service, ruleOf]);

  const elsewhere = picked.map(choiceOf).filter((c) => c && c.service !== service).length;

  return (
    <div className="stack gap-12">
      <Field label="Site or app" hint={org ? 'jinbe, or a site this organization is entitled to.' : 'jinbe is the platform itself; a site grants on its own routes only.'}>
        <Select value={service} onChange={(e) => setService(e.target.value)}>
          {options.services.map((s) => <option key={s} value={s}>{s === 'jinbe' ? 'jinbe (platform)' : s}</option>)}
        </Select>
      </Field>
      {options.loading
        ? <EmptyHint>Reading what {service} offers…</EmptyHint>
        : groups.length === 0
          ? <EmptyHint>{service} offers no role or permission{org ? ' in this organization' : ''}.</EmptyHint>
          : <ChecklistGroups label="Roles and permissions" groups={groups} value={picked} onChange={(next) => { setPicked(next); emit(next, reason, expiry); }} />}
      {elsewhere > 0 && (
        <div className="small muted">
          Also picked on other sites: {picked.map(choiceOf).filter((c): c is NonNullable<typeof c> => !!c && c.service !== service).map(grantLabel).join(', ')}.
        </div>
      )}
      <Field label={<>Reason <span className="muted">(optional)</span></>} hint="Shown wherever the grant is listed, and in the audit trail.">
        <Input placeholder="e.g. covering the payroll close, ticket OPS-123" value={reason} onChange={(e) => { setReason(e.target.value); emit(picked, e.target.value, expiry); }} />
      </Field>
      <ExpiryPicker onChange={(v) => { setExpiry(v); emit(picked, reason, v); }} />
    </div>
  );
}
