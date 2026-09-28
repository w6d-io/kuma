import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, Checkbox, Dialog, EmptyHint, Field, FieldRow, I, Input, Select, Table, Th } from './ui';
import { sitesApi, siteKeys, useGateways, useZones, type SiteError } from '../api/sites';
import { useSiteAction } from '../pages/sites/useAction';
import { useSitePerms } from '../pages/sites/usePerms';
import type { Check, GatewayInfo, Zone, ZoneIngress } from '../lib/sites/types';
import { ENTRY_LABEL, INGRESS_LABEL, anyProtected, defaultGateway, entryOf, gatewayProblem, nextStep, protectionOf } from '../lib/sites/zones';

/**
 * Settings · Zones: the wildcard domains sites live under, how each is reached (nginx, the Envoy
 * Gateway, or both while it migrates) and whether that is behind the WAF. A zone moves to the Gateway
 * in three steps — attach the Gateway, move DNS, drop the Ingress — each one an edit here; jinbe
 * refuses to drop the Ingress while a site host still resolves elsewhere, unless confirmed.
 */

const refOf = (key: string) => {
  const [namespace, name] = key.split('/');
  return { namespace, name };
};

function ProtectionBadge({ zone, gateways }: { zone: Zone; gateways?: GatewayInfo[] }) {
  const p = protectionOf(zone, gateways);
  return (
    <Badge tone={p.tone} mono={false} title={p.detail}>
      {p.label}
    </Badge>
  );
}

/** A Gateway as an option: its name and whether its WAF and IP bans are in force. */
function gatewayOption(g: GatewayInfo) {
  return `${g.key} — ${g.protection.protected ? 'protected by WAF' : 'NOT protected'}`;
}

function GatewayPicker({
  value,
  onChange,
  gateways,
  allowNone,
  domain,
  tls,
}: {
  value: string;
  onChange: (v: string) => void;
  gateways: GatewayInfo[];
  allowNone: boolean;
  domain: string;
  tls: 'default' | 'issuer' | 'secret';
}) {
  const gw = gateways.find((g) => g.key === value);
  const problem = gatewayProblem(gw, domain, tls);
  return (
    <Field
      label="Gateway"
      error={problem ?? undefined}
      warning={gw && !gw.protection.protected ? gw.protection.summary : undefined}
      hint={gw?.protection.protected ? gw.protection.summary : 'Envoy Gateway: every route behind the WAF and IP bans.'}
    >
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">None (nginx only)</option>}
        {gateways.map((g) => (
          <option key={g.key} value={g.key}>
            {gatewayOption(g)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ChecksList({ checks }: { checks: Array<Check & { host?: string }> }) {
  if (checks.length === 0) return null;
  return (
    <ul className="site-list small">
      {checks.map((c, i) => (
        <li key={i}>
          <Badge tone={c.level === 'error' ? 'danger' : c.level === 'warn' ? 'warning' : 'neutral'} mono={false}>
            {c.host ?? c.code}
          </Badge>{' '}
          {c.message}
        </li>
      ))}
    </ul>
  );
}

function EditExposure({ zone, gateways, onClose }: { zone: Zone; gateways: GatewayInfo[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { run, busy } = useSiteAction();
  const [gateway, setGateway] = useState(zone.gateway ?? '');
  const [ingress, setIngress] = useState<ZoneIngress>(zone.ingress ?? 'wildcard');
  const [dnsChecks, setDnsChecks] = useState<Array<Check & { host?: string }> | null>(null);
  const [ack, setAck] = useState(false);
  const noEntry = ingress === 'none' && !gateway;
  // Detaching the Gateway while a WAF-protected one exists: explicit and audited.
  const available = anyProtected(gateways);
  const optOut = !gateway && !!zone.gateway && !!available;
  const problem = gatewayProblem(
    gateways.find((g) => g.key === gateway),
    zone.suffix,
    'default',
  );

  async function save(confirm = false) {
    const name = zone.name;
    if (!name) return;
    const body = {
      ...(gateway !== (zone.gateway ?? '') ? { gateway: gateway ? refOf(gateway) : null } : {}),
      ...(ingress !== (zone.ingress ?? 'wildcard') ? { ingress } : {}),
      ...(confirm ? { confirm: true } : {}),
      ...(optOut ? { acknowledgeNoWaf: true } : {}),
    };
    // A DNS refusal is an answer shown in the dialog, not a failure toast.
    const out = await run('Save', async () => {
      try {
        return await sitesApi.updateZone(name, body);
      } catch (err) {
        if ((err as SiteError).code !== 'dns_not_on_gateway') throw err;
        setDnsChecks(((err as SiteError).details?.checks ?? []) as Array<Check & { host?: string }>);
        return null;
      }
    });
    if (!out) return;
    qc.invalidateQueries({ queryKey: siteKeys.zones() });
    if (out.checks?.length) setDnsChecks(out.checks);
    else onClose();
  }

  const refused = dnsChecks?.some((c) => c.level === 'error');
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={`Zone ${zone.name}`}
      title={`How *.${zone.suffix} is reached`}
      footer={
        <>
          <Button onClick={onClose}>{dnsChecks && !refused ? 'Done' : 'Cancel'}</Button>
          {refused ? (
            <Button variant="danger" loading={busy === 'Save'} onClick={() => save(true)}>
              Drop the Ingress anyway
            </Button>
          ) : (
            !dnsChecks && (
              <Button variant="primary" disabled={noEntry || !!problem || (optOut && !ack)} onClick={() => save()}>
                Save
              </Button>
            )
          )}
        </>
      }
    >
      <div className="stack gap-12">
        <FieldRow>
          <GatewayPicker value={gateway} onChange={setGateway} gateways={gateways} allowNone domain={zone.suffix} tls="default" />
          <Field
            label="nginx Ingress"
            error={noEntry ? 'Without an Ingress the zone needs a Gateway.' : undefined}
            hint={ingress === 'none' ? 'Only the Gateway answers: nothing reaches the sites around the WAF.' : 'Still answers on the nginx load balancer (no WAF).'}
          >
            <Select value={ingress} onChange={(e) => setIngress(e.target.value as ZoneIngress)}>
              {(['wildcard', 'per-site', 'none'] as ZoneIngress[]).map((m) => (
                <option key={m} value={m}>
                  {INGRESS_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        {nextStep({ ingress, gateway: gateway || undefined }) && <p className="small m-0 muted">{nextStep({ ingress, gateway: gateway || undefined })}</p>}
        {optOut && !dnsChecks && <NoWafNotice available={available} ack={ack} onAck={setAck} />}
        {dnsChecks && (
          <Callout
            tone={refused || dnsChecks.some((c) => c.level === 'warn') ? 'warning' : 'success'}
            icon={refused ? I.alert : I.check}
            title={refused ? 'Some site hosts do not point at the Gateway yet' : 'Saved'}
          >
            <ChecksList checks={dnsChecks} />
            {refused && (
              <p className="small mb-0">
                Dropping the Ingress now cuts off the visitors DNS still sends to nginx. Move their records first (per-host record → the Gateway address), or drop it anyway.
              </p>
            )}
          </Callout>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Opting out of the WAF: said, and confirmed, whenever a WAF-protected Gateway exists (owner decision:
 * WAF by default; nginx on purpose is explicit and audited). Without one, nginx is the fallback, warned.
 */
function NoWafNotice({ available, ack, onAck, hint }: { available: GatewayInfo | null; ack: boolean; onAck: (v: boolean) => void; hint?: string | null }) {
  if (!available) {
    return (
      <Callout tone="warning" icon={I.alert} title="No WAF">
        No WAF-protected Gateway was found in the cluster: this zone will be served by the nginx Ingress, without WAF or IP bans.
      </Callout>
    );
  }
  return (
    <Callout tone="warning" icon={I.alert} title="This zone will have no WAF">
      <p className="small mt-0">
        {available.key} would inspect every request with its WAF; on the nginx Ingress the sites get no WAF and no IP bans.{hint ? ` ${hint}` : ''}
      </p>
      <Checkbox checked={ack} onChange={onAck} label="Use the nginx Ingress without WAF (recorded in the audit log)" />
    </Callout>
  );
}

function CreateZone({ gateways, onClose }: { gateways: GatewayInfo[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { run, busy } = useSiteAction();
  const [domain, setDomain] = useState('');
  // null = not chosen: the WAF-protected Gateway that can serve the domain, else nginx
  const [gatewayChoice, setGatewayChoice] = useState<string | null>(null);
  const [ingressChoice, setIngressChoice] = useState<ZoneIngress | null>(null);
  const [tls, setTls] = useState<'default' | 'issuer'>('default');
  const [ack, setAck] = useState(false);
  const d = domain.trim().toLowerCase().replace(/^\*\./, '');
  const auto = defaultGateway(gateways, d, tls);
  const gateway = gatewayChoice ?? auto?.key ?? '';
  const ingress: ZoneIngress = ingressChoice ?? (gateway ? 'none' : 'wildcard');
  const available = anyProtected(gateways);
  const problem = gatewayProblem(
    gateways.find((g) => g.key === gateway),
    d,
    tls,
  );
  const noEntry = ingress === 'none' && !gateway;
  const noWaf = !gateway;
  const issuerHint =
    noWaf && tls === 'default' && d && !auto && defaultGateway(gateways, d, 'issuer')
      ? `It has no listener for *.${d}: choose "Issued for the zone" to put it behind the WAF.`
      : null;

  async function create() {
    const out = await run(
      'Create zone',
      () =>
        sitesApi.createZone({
          domain: d,
          ingress,
          tls: { mode: tls },
          ...(gateway ? { gateway: refOf(gateway) } : {}),
          ...(noWaf && available ? { acknowledgeNoWaf: true } : {}),
        }),
      'Zone created',
    );
    if (out) {
      qc.invalidateQueries({ queryKey: siteKeys.zones() });
      onClose();
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create zone"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy === 'Create zone'} disabled={!d || noEntry || !!problem || (noWaf && !!available && !ack)} onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <div className="stack gap-12">
        <Field label="Domain" hint={d ? `Sites live one label under it: <name>.${d}` : 'e.g. apps.dev.example.com'}>
          <Input mono value={domain} placeholder="apps.dev.example.com" onChange={(e) => setDomain(e.target.value)} />
        </Field>
        <FieldRow>
          <GatewayPicker
            value={gateway}
            onChange={(v) => {
              setGatewayChoice(v);
              if (!v && ingress === 'none') setIngressChoice('wildcard');
            }}
            gateways={gateways}
            allowNone
            domain={d}
            tls={tls}
          />
          <Field label="nginx Ingress" error={noEntry ? 'Without an Ingress the zone needs a Gateway.' : undefined}>
            <Select value={ingress} onChange={(e) => setIngressChoice(e.target.value as ZoneIngress)}>
              {(['none', 'wildcard', 'per-site'] as ZoneIngress[]).map((m) => (
                <option key={m} value={m}>
                  {INGRESS_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Certificate">
            <Select value={tls} onChange={(e) => setTls(e.target.value as 'default' | 'issuer')}>
              <option value="default">{gateway ? 'The Gateway listener’s' : 'The ingress default'}</option>
              <option value="issuer">Issued for the zone</option>
            </Select>
          </Field>
        </FieldRow>
        {noWaf && d && <NoWafNotice available={available} ack={ack} onAck={setAck} hint={issuerHint} />}
      </div>
    </Dialog>
  );
}

export function ZonesSettings() {
  const zones = useZones();
  const gateways = useGateways();
  const { canApply } = useSitePerms();
  const [editing, setEditing] = useState<Zone | null>(null);
  const [creating, setCreating] = useState(false);
  const list = (zones.data ?? []).filter((z) => z.source !== 'config');
  const gws = gateways.data?.gateways ?? [];

  return (
    <Card
      id="zones"
      title="Zones"
      sub="The domains sites live under, how each is reached, and whether that is behind the WAF (Envoy Gateway: Coraza + IP bans)."
      actions={
        canApply && (
          <Button size="sm" icon={I.plus} onClick={() => setCreating(true)}>
            Create zone
          </Button>
        )
      }
    >
      {zones.isLoading ? (
        <EmptyHint>Loading…</EmptyHint>
      ) : list.length === 0 ? (
        <EmptyHint>No zones defined in the cluster.</EmptyHint>
      ) : (
        <Table aria-label="Zones">
          <thead>
            <tr>
              <Th>Zone</Th>
              <Th>Reached through</Th>
              <Th>WAF</Th>
              <Th>Ready</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((z) => (
              <tr key={z.name ?? z.suffix}>
                <td>
                  <span className="mono small">{z.wildcard}</span>
                  {z.name && <div className="small muted">{z.name}</div>}
                </td>
                <td className="small">
                  {ENTRY_LABEL[entryOf(z)]}
                  <div className="muted">
                    {INGRESS_LABEL[z.ingress ?? 'wildcard']}
                    {z.gateway ? ` · ${z.gateway}` : ''}
                  </div>
                </td>
                <td>
                  <ProtectionBadge zone={z} gateways={gws} />
                </td>
                <td>
                  {z.ready === undefined ? (
                    <Badge tone="neutral" mono={false}>
                      unknown
                    </Badge>
                  ) : (
                    <Badge tone={z.ready ? 'success' : 'warning'} mono={false}>
                      {z.ready ? 'ready' : 'not ready'}
                    </Badge>
                  )}
                </td>
                <td>
                  {canApply && z.name && gws.length > 0 && (
                    <Button size="sm" onClick={() => setEditing(z)}>
                      Edit exposure
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <EditExposure zone={editing} gateways={gws} onClose={() => setEditing(null)} />}
      {creating && <CreateZone gateways={gws} onClose={() => setCreating(false)} />}
    </Card>
  );
}
