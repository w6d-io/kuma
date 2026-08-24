import { useState, useEffect, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { I } from '../components/ui/Icons';
import { ServiceFavicon } from '../components/ServiceFavicon';
import { Chip, Avatar, Drawer, AccessLevel, EmptyHint } from '../components/ui/Primitives';
import { serviceGatewayPosture, rulePosture } from '../components/HandlerStageEditor';
import { accessLevelOf } from '../hooks/useRbac';
import { useApplyChange } from '../hooks/useApplyChange';
import { useStats, useAuditEvents, useOathkeeperHandlers } from '../api/hooks';
import type { SignInMethod } from '../api/client';
import { RiskBadge, riskOf } from './Audit';
import { RolesPage } from './Roles';
import { RoutesPage } from './Routes';
import { RulesPage } from './Rules';

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

// Sign-in methods a service can accept — ordered fallback (the gateway tries
// each in turn): cookie → bearer → introspection. None checked = public.
const SIGN_IN_OPTIONS: { id: SignInMethod; handler: string; label: string; hint: string }[] = [
  { id: 'cookie',        handler: 'cookie_session',       label: 'Browser session (cookie)', hint: 'People signed in through the login page.' },
  { id: 'bearer',        handler: 'bearer_token',         label: 'API token (Bearer)',       hint: 'Scripts and CLIs holding a session token.' },
  { id: 'introspection', handler: 'oauth2_introspection', label: 'OAuth2 access token',      hint: 'Third-party apps and M2M keys (introspected).' },
];

/** Derive the checked sign-in methods from a rule's authenticator handler names. */
function signInFromAuthenticators(handlers: string[]): SignInMethod[] {
  return SIGN_IN_OPTIONS.filter(o => handlers.includes(o.handler)).map(o => o.id);
}

type SvcTab = 'overview' | 'health' | 'roles' | 'routes' | 'gateway';
const SVC_TABS: SvcTab[] = ['overview', 'health', 'roles', 'routes', 'gateway'];
const SVC_TAB_LABEL: Record<SvcTab, string> = { overview: 'Overview', health: 'Health', roles: 'Roles', routes: 'Routes', gateway: 'Gateway' };

// Per-service summary used by the left-rail rows.
function svcSummary(state: ReturnType<typeof useApp>['state'], name: string, perService?: Record<string, number>) {
  const roles = Object.keys(state.roles[name] || {}).length;
  const routes = state.routeMaps[name] || [];
  const openRoutes = routes.filter(r => !r.permission).length;
  const rules = state.accessRules.filter(r => r.service === name);
  const groups = Object.entries(state.groups).filter(([, m]) => m[name]).length;
  // Per-service member count comes from the cached stats endpoint — no directory walk.
  const users = perService?.[name] ?? 0;
  return { roles, routes: routes.length, openRoutes, rules: rules.length, groups, users };
}

// The Services workspace: one entry per service (no more repeated rows), each
// nesting everything it owns — Overview · Roles · Routes · Gateway — so the
// service↔role↔route↔gateway relationship is a single drill-down instead of
// four scattered top-level tabs sharing a hidden active-service.
export function ServicesPage() {
  const { state, setServiceDrawer, activeService, setActiveService, isLoading, apiError, page } = useApp();
  const { data: stats } = useStats();
  const names = state.services.map(s => s.name);
  // Gateway rules whose (re-associated) service isn't in the registry — infra /
  // legacy rules that would otherwise be invisible in every tab.
  const orphanRules = state.accessRules.filter(r => !names.includes(r.service));
  const UNASSIGNED = '__unassigned__';
  const isUnassigned = activeService === UNASSIGNED && orphanRules.length > 0;
  const sel = isUnassigned ? UNASSIGNED : (activeService && names.includes(activeService) ? activeService : (names[0] ?? ""));
  const service = state.services.find(s => s.name === sel);
  const [tab, setTab] = useState<SvcTab>('overview');
  const [q, setQ] = useState("");

  // The `roles`/`routes`/`rules` page aliases render this workspace; honor them
  // as sub-tab deep-links (e.g. the gateway editor's "Manage roles" / "See
  // routes"). Only fires on a page change, so manual sub-tab clicks stick.
  useEffect(() => {
    if (page === 'roles') setTab('roles');
    else if (page === 'routes') setTab('routes');
    else if (page === 'rules') setTab('gateway');
  }, [page]);

  const isGlobal = service?.name === 'global';
  const effectiveTab: SvcTab = isGlobal && (tab === 'routes' || tab === 'gateway') ? 'overview' : tab;
  const filtered = state.services.filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()));

  const header = (
    <div className="page-head">
      <div><h1>Services</h1><div className="sub">Everything a service owns — roles, routes and gateway — in one place</div></div>
      <div className="page-actions">
        <button className="btn primary" onClick={() => setServiceDrawer({ mode: "create" })}>
          <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.plus}</span> Register service
        </button>
      </div>
    </div>
  );

  if (names.length === 0) {
    const err = apiError as { status?: number } | null;
    if (isLoading) {
      return <>{header}<div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="muted small">Loading services…</div></div></>;
    }
    if (err && err.status !== 403 && err.status !== 401) {
      return <>{header}<div className="panel" style={{ padding: 40, textAlign: 'center' }}><div style={{ color: 'var(--err)' }}>Couldn't load services{err.status ? ` (HTTP ${err.status})` : ''}. Retry shortly.</div></div></>;
    }
    return <>{header}<div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="muted small">No services yet — register one to define its roles and routes.</div></div></>;
  }

  return (
    <>
      {header}
      <div className="grid" style={{ gridTemplateColumns: "280px 1fr", gap: 14, alignItems: 'start' }}>
        {/* Left rail — one row per service */}
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="Search services…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
          </div>
          {(() => {
            const renderRow = (s: typeof filtered[number]) => {
              const sm = svcSummary(state, s.name, stats?.perService);
              const on = s.name === sel;
              // Posture at a glance — aggregated from the service's gateway rules
              // (skipped for the virtual `global` service, which has no gateway).
              const svcRules = state.accessRules.filter(r => r.service === s.name);
              const posture = s.name === 'global' ? null : serviceGatewayPosture(svcRules.map(r => ({ authenticators: r.authenticators, authorizer: r.authorizer })));
              return (
                <button key={s.name} onClick={() => setActiveService(s.name)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--line)', background: on ? 'var(--panel-2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center' }}>
                  <span style={{ color: 'var(--ink-3)', flexShrink: 0, display: 'grid', placeItems: 'center', width: 15, height: 15 }}>{s.name === 'global' ? I.globe : s.system ? I.box : <ServiceFavicon name={s.name} size={15} />}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="mono" style={{ fontWeight: on ? 600 : 500, fontSize: 12.5 }}>{s.name}</span>
                    <div className="small muted mt-4">
                      {sm.roles} roles · {sm.routes} routes
                      {sm.openRoutes > 0 && <> · <span style={{ color: 'var(--warn)' }} title={`${sm.openRoutes} route${sm.openRoutes !== 1 ? 's' : ''} reachable with no permission (public)`}>{sm.openRoutes} public</span></>}
                    </div>
                  </div>
                  {posture && <Chip tone={posture.tone} mono={false} title={`Gateway protection across this service's ${svcRules.length} rule${svcRules.length !== 1 ? 's' : ''}`}>{posture.label}</Chip>}
                </button>
              );
            };
            const regular = filtered.filter(s => !s.system);
            const sys = filtered.filter(s => s.system);
            return (
              <>
                {regular.length > 0 && <div className="nav-section" style={{ padding: '8px 12px 4px' }}>Your services</div>}
                {regular.map(renderRow)}
                {sys.length > 0 && <div className="nav-section" style={{ padding: '10px 12px 4px', borderTop: regular.length ? '1px solid var(--line)' : undefined }}>System</div>}
                {sys.map(renderRow)}
                {orphanRules.length > 0 && (
                  <>
                    <div className="nav-section" style={{ padding: '10px 12px 4px', borderTop: '1px solid var(--line)' }}>Other</div>
                    <button onClick={() => setActiveService(UNASSIGNED)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--line)', background: isUnassigned ? 'var(--panel-2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center' }}>
                      <span style={{ color: 'var(--warn)', flexShrink: 0, display: 'grid', placeItems: 'center', width: 15, height: 15 }}>{I.alert}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: isUnassigned ? 600 : 500, fontSize: 12.5 }}>Unassigned rules</span>
                        <div className="small muted mt-4" title="Gateway rules not tied to a registered service">{orphanRules.length} gateway rule{orphanRules.length !== 1 ? 's' : ''} with no service</div>
                      </div>
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>

        {/* Right — the selected service and its nested config */}
        <div style={{ minWidth: 0 }}>
          {isUnassigned ? (
            <>
              <div className="panel-head" style={{ marginBottom: 12 }}>
                <div><h3>Unassigned gateway rules</h3><div className="sub">Rules whose service isn't in your registry — infrastructure or legacy routing</div></div>
              </div>
              <RulesPage unassigned />
            </>
          ) : service && (
            <>
              <div className="panel-head" style={{ marginBottom: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="row" style={{ gap: 8 }}>
                    {!isGlobal && !service.system && <ServiceFavicon name={service.name} size={18} />}
                    <span className="mono">{service.name}</span>
                    {isGlobal && <Chip tone="info">virtual</Chip>}
                    {service.system && <Chip tone="info" title="Bootstrap-protected — cannot be deleted">🔒 system</Chip>}
                  </h3>
                  <div className="sub">{service.upstreamUrl ? <>Internal service · <span className="mono">{service.upstreamUrl}</span></> : 'Virtual service — roles only, no gateway'}</div>
                </div>
                {!isGlobal && (
                  <button className="btn" onClick={() => setServiceDrawer({ mode: 'edit', serviceName: service.name })}>
                    <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.edit}</span> Edit
                  </button>
                )}
              </div>

              <div className="seg" style={{ marginBottom: 12 }}>
                {SVC_TABS.map(t => {
                  const disabled = isGlobal && (t === 'routes' || t === 'gateway');
                  return <button key={t} className={effectiveTab === t ? 'on' : ''} disabled={disabled} onClick={() => setTab(t)}>{SVC_TAB_LABEL[t]}</button>;
                })}
              </div>

              {effectiveTab === 'overview' && <>
                <ServiceOverview name={service.name} onEdit={() => setServiceDrawer({ mode: 'edit', serviceName: service.name })} />
                {!isGlobal && <ServiceActivity name={service.name} />}
              </>}
              {effectiveTab === 'health' && <ServiceHealth name={service.name} />}
              {effectiveTab === 'roles' && <RolesPage svc={service.name} />}
              {effectiveTab === 'routes' && !isGlobal && <RoutesPage svc={service.name} />}
              {effectiveTab === 'gateway' && !isGlobal && <RulesPage svc={service.name} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ServiceOverview({ name, onEdit }: { name: string; onEdit: () => void }) {
  const { state } = useApp();
  const { data: stats } = useStats();
  const sm = svcSummary(state, name, stats?.perService);
  const perms = Object.values(state.roles[name] || {}).flat();
  const level = perms.length === 0 ? 'none' : accessLevelOf(perms);
  return (
    <>
      <div className="grid g4 mb-12" style={{ gap: 10 }}>
        <div className="stat"><div className="lbl">Roles</div><div className="val">{sm.roles}</div></div>
        <div className="stat"><div className="lbl">Routes</div><div className="val">{sm.routes}</div></div>
        <div className="stat"><div className="lbl">Groups</div><div className="val">{sm.groups}</div></div>
        <div className="stat"><div className="lbl">Users</div><div className="val">{sm.users}</div></div>
      </div>
      <div className="panel">
        <div className="panel-head"><div><h3>Access summary</h3><div className="sub">Who can reach this service, and how it's protected</div></div><AccessLevel level={level} /></div>
        <div className="panel-body col" style={{ gap: 10 }}>
          <div className="small">{sm.openRoutes > 0
            ? <><span style={{ color: 'var(--warn)' }}>⚠ {sm.openRoutes} public route{sm.openRoutes !== 1 ? 's' : ''}</span> — reachable with no permission.</>
            : sm.routes > 0 ? 'Every route requires a permission.' : 'No routes defined yet.'}</div>
          <div className="small muted">Reached via <b>{sm.groups}</b> group{sm.groups !== 1 ? 's' : ''} → <b>{sm.users}</b> user{sm.users !== 1 ? 's' : ''}.</div>
          {(() => {
            const rules = state.accessRules.filter(r => r.service === name);
            const main = rules.find(r => r.id === name) ?? rules[0];
            return main?.match?.url ? <div className="small muted">Public path: <a className="mono" href={main.match.url.replace(/<[^>]*>/g, '')} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{main.match.url}</a></div> : null;
          })()}
          {name !== 'global' && !state.services.find(s => s.name === name)?.system && (
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <button className="btn ghost sm" onClick={onEdit}><span style={{ width: 13, height: 13, display: 'grid', placeItems: 'center' }}>{I.edit}</span> Edit service</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ServiceHealth({ name }: { name: string }) {
  const { state } = useApp();
  const roles = state.roles[name] || {};
  const routes = state.routeMaps[name] || [];
  const rules = state.accessRules.filter(r => r.service === name);
  const allPerms = new Set(Object.values(roles).flat());
  const hasWildcard = allPerms.has('*');

  const checks: { ok: boolean; label: string; detail?: string }[] = [];
  const emptyRoles = Object.entries(roles).filter(([, p]) => p.length === 0).map(([r]) => r);
  checks.push({ ok: emptyRoles.length === 0, label: emptyRoles.length ? `${emptyRoles.length} role(s) grant no permission` : 'Every role grants at least one permission', detail: emptyRoles.join(', ') });
  const orphan = routes.filter(r => r.permission && !hasWildcard && !allPerms.has(r.permission));
  checks.push({ ok: orphan.length === 0, label: orphan.length ? `${orphan.length} route(s) require a permission no role grants` : 'Every protected route is grantable by a role', detail: orphan.map(r => `${r.method} ${r.path} → ${r.permission}`).slice(0, 4).join('  ·  ') });
  const pub = routes.filter(r => !r.permission);
  checks.push({ ok: pub.length === 0, label: pub.length ? `${pub.length} public route(s) — reachable with no permission` : 'No public routes', detail: pub.map(r => `${r.method} ${r.path}`).slice(0, 4).join('  ·  ') });
  const dangling: string[] = [];
  Object.entries(state.groups).forEach(([g, m]) => (m[name] || []).forEach(rn => { if (!roles[rn]) dangling.push(`${g} → ${rn}`); }));
  checks.push({ ok: dangling.length === 0, label: dangling.length ? `${dangling.length} group reference(s) to a role that doesn't exist` : 'All group references resolve to a real role', detail: dangling.slice(0, 4).join('  ·  ') });
  if (name !== 'global') {
    const openRules = rules.filter(r => r.authorizer === 'allow').length;
    checks.push({ ok: rules.length > 0, label: rules.length === 0 ? 'No gateway rule — traffic to this service is not routed' : `${rules.length} gateway rule(s)${openRules ? ` · ${openRules} open` : ''}`, detail: rules.length === 0 ? 'Add a match URL + upstream (Edit) to route traffic through the gateway.' : undefined });
  }
  const problems = checks.filter(c => !c.ok).length;

  return (
    <div className="panel">
      <div className="panel-head">
        <div><h3>Health</h3><div className="sub">Integrity checks for this service</div></div>
        {problems === 0 ? <Chip tone="ok">healthy</Chip> : <Chip tone="warn">{problems}</Chip>}
      </div>
      <div style={{ padding: 0 }}>
        {checks.map((c, i) => (
          <div key={i} style={{ padding: '10px 14px', borderBottom: i < checks.length - 1 ? '1px solid var(--line)' : 'none', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: c.ok ? 'var(--ok)' : 'var(--warn)', marginTop: 1, flexShrink: 0 }}>{c.ok ? I.check : I.alert}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="small" style={{ color: 'var(--ink)' }}>{c.label}</div>
              {!c.ok && c.detail && <div className="small muted mono mt-4" style={{ wordBreak: 'break-all' }}>{c.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Per-service Activity trail (Part D). Sources the service's own audit fan-out
// key via GET /audit/events?service=<name>: posture-now + last-change sentence,
// change history, who-touched-it, and access denials at the service.
function ServiceActivity({ name }: { name: string }) {
  const { state } = useApp();
  const q = useAuditEvents({ service: name, limit: 100 });
  const events = q.data ?? [];

  const svcRules = state.accessRules.filter(r => r.service === name);
  const posture = serviceGatewayPosture(svcRules.map(r => ({ authenticators: r.authenticators, authorizer: r.authorizer })));

  const changes = events.filter(e => (e.kind || 'change') === 'change' || ['create', 'update', 'delete', 'add', 'revoke'].includes(e.verb));
  const denials = events.filter(e => e.status === 'failed' || e.verb === 'fail' || e.verb === 'deny');
  const lastChange = changes[0];
  const whoTouched = Array.from(
    events.filter(e => e.who && e.who !== 'system' && e.who !== 'anon')
      .reduce<Map<string, number>>((m, e) => m.set(e.who, (m.get(e.who) || 0) + 1), new Map())
      .entries(),
  ).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <>
      {/* Posture-now + last-change sentence */}
      <div className="panel mb-12">
        <div className="panel-head">
          <div><h3>Posture now</h3><div className="sub">Protection and the most recent change</div></div>
          {posture && <Chip tone={posture.tone} mono={false}>{posture.label}</Chip>}
        </div>
        <div className="panel-body col" style={{ gap: 6 }}>
          <div className="small">
            {lastChange
              ? <>Last changed <b>{lastChange.when}</b> by <span className="mono">{lastChange.who || 'system'}</span> — {lastChange.changes?.summary || `${lastChange.verb} ${lastChange.target}`}.</>
              : q.isLoading ? 'Loading…' : 'No configuration changes recorded in the retained window.'}
          </div>
          {denials.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>⚠ {denials.length} access denial{denials.length === 1 ? '' : 's'} at this service in the window.</div>}
        </div>
      </div>

      {/* Who touched it */}
      {whoTouched.length > 0 && (
        <div className="panel mb-12">
          <div className="panel-head"><div><h3>Who touched it</h3><div className="sub">Actors active on this service</div></div></div>
          <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {whoTouched.map(([who, n]) => (
              <span key={who} className="row" style={{ gap: 6, alignItems: 'center', padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 999 }}>
                <Avatar email={who} size={18} />
                <span className="small mono">{who.split('@')[0]}</span>
                <Chip>{n}</Chip>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Change history */}
      <div className="panel">
        <div className="panel-head"><div><h3>Change history</h3><div className="sub">Configuration changes & denials at this service</div></div><Chip>{events.length}</Chip></div>
        <div style={{ padding: 0 }}>
          {q.isError ? (
            <div style={{ padding: 20 }}>
              <span className="small" style={{ color: 'var(--danger, #c0392b)' }}>Couldn&apos;t load this service&apos;s activity — load error, not "no activity". Reload to retry.</span>
            </div>
          ) : events.length === 0 ? (
            <div style={{ padding: 18 }}><EmptyHint>{q.isLoading ? 'Loading…' : 'No activity recorded for this service.'}</EmptyHint></div>
          ) : events.map(e => {
            const isFail = e.status === 'failed' || e.verb === 'fail' || e.verb === 'deny';
            const risk = riskOf(e);
            return (
              <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--line)', borderLeft: risk.level !== 'none' ? `2px solid var(--${risk.tone})` : '2px solid transparent' }}>
                <span className="small muted mono nowrap" style={{ width: 66 }}>{e.when}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip tone={isFail ? 'err' : ''}>{e.verb}</Chip>
                    <span className="small mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.changes?.summary || e.target || e.path}</span>
                    <RiskBadge e={e} />
                  </div>
                  <div className="small muted mono mt-4">{e.who || 'system'}</div>
                </div>
                {isFail && <Chip tone="err">{e.verb === 'deny' ? 'denied' : 'failed'}</Chip>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// One handler array (authenticators / authorizer / mutators) as a labelled row
// of chips. Empty (or all-dropped) → an em dash. Reflects the payload verbatim,
// so a live rule's real handlers (e.g. `oauth2_introspection` + `allow` +
// `header`) show as-is — nothing is assumed to be `remote_json`.
function HandlerArrayChips({ label, items }: { label: string; items: string[] }) {
  const shown = items.filter(Boolean);
  return (
    <span className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="muted">{label}:</span>
      {shown.length === 0 ? <span className="muted">—</span> : shown.map(h => <Chip key={h}>{h}</Chip>)}
    </span>
  );
}

// Read-only summary of every gateway rule a service owns, with the handler
// arrays (sign-in / permission / info-sent) surfaced as chips. The edit drawer
// only edits the primary rule's match/upstream/strip; previously the other
// rules and ALL the handler arrays were invisible from the service view. Full
// editing lives in the service's Gateway tab (RulesPage), which owns the same
// rules-list rail — this reuses its posture-chip pattern rather than duplicating
// an editor.
function ServiceRulesList({ svcName }: { svcName: string }) {
  const { state } = useApp();
  const rules = state.accessRules.filter(r => r.service === svcName);
  if (rules.length === 0) return null;
  return (
    <div className="mb-12">
      <label className="input-label">Gateway rules <span className="muted">({rules.length})</span></label>
      <div className="panel" style={{ padding: 0 }}>
        {rules.map((r, i) => {
          const p = rulePosture(r.authenticators, r.authorizer);
          return (
            <div key={r.id} style={{ padding: '10px 12px', borderBottom: i < rules.length - 1 ? '1px solid var(--line)' : 'none' }}>
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono small" style={{ fontWeight: 600 }}>{r.id}</span>
                <Chip tone={p.tone} mono={false} title={p.sentence}>{p.label}</Chip>
              </div>
              <div className="small muted mono mt-4" style={{ wordBreak: 'break-all' }}>{r.match.methods.join(', ') || 'no methods'} · {r.match.url}</div>
              <div className="row mt-4" style={{ gap: 12, flexWrap: 'wrap', rowGap: 4 }}>
                <HandlerArrayChips label="Sign-in" items={r.authenticators} />
                <HandlerArrayChips label="Permission" items={r.authorizer ? [r.authorizer] : []} />
                <HandlerArrayChips label="Info sent" items={r.mutators} />
              </div>
              {r.upstream && <div className="small muted mono mt-4" style={{ wordBreak: 'break-all' }}>&rarr; {r.upstream}{r.stripPath ? ` (strip ${r.stripPath})` : ''}</div>}
            </div>
          );
        })}
      </div>
      <div className="input-hint">Read-only summary of the real gateway rules. Use the service&apos;s Gateway tab to change protection, handlers or routing.</div>
    </div>
  );
}

export function ServiceDrawer() {
  const { serviceDrawer, setServiceDrawer, state, apiCreateService, apiUpdateService, apiDeleteService, setPage } = useApp();
  const applyChange = useApplyChange();

  const isEdit = serviceDrawer?.mode === "edit";
  const editSvc = isEdit && serviceDrawer?.serviceName ? state.services.find(s => s.name === serviceDrawer.serviceName) : null;
  const editRule = editSvc ? state.accessRules.find(r => r.service === editSvc.name) : null;

  // create fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // shared fields (create + edit)
  const [upstream, setUpstream] = useState("");
  const [matchUrl, setMatchUrl] = useState("");
  const [matchMethods, setMatchMethods] = useState<string[]>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  const [stripPath, setStripPath] = useState("");
  const [signIn, setSignIn] = useState<SignInMethod[]>(['cookie']);
  // Which authenticators the deployed gateway actually supports — methods
  // whose handler isn't enabled render locked (jinbe rejects them anyway).
  const { data: handlerCatalog } = useOathkeeperHandlers();
  const enabledAuthn = new Set((handlerCatalog?.authenticators ?? []).map(h => h.handler));

  // edit danger
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Pristine while the operator hasn't touched a field. The late-arrival re-seed
  // below is gated on this so it can populate empty fields but never clobber an
  // edit already in progress. Reset to true on every open (primary seed effect).
  const pristineRef = useRef(true);
  const markDirty = () => { pristineRef.current = false; };

  // Seed form when the drawer opens (keyed on mode+serviceName). editSvc/editRule
  // derive from the live cache and would re-seed on optimistic edits, wiping the
  // operator's changes — intentionally excluded here; the keyed effect below
  // handles the one case they must drive (a rule that associates AFTER open).
  useEffect(() => {
    if (!serviceDrawer) return;
    setConfirmDelete(false);
    pristineRef.current = true;
    if (serviceDrawer.mode === "create") {
      setName(""); setUpstream(""); setDescription(""); setMatchUrl(""); setStripPath("");
      setMatchMethods(["GET", "POST", "PUT", "PATCH", "DELETE"]);
      setSignIn(['cookie']);
    } else if (isEdit && editSvc) {
      setUpstream(editSvc.upstreamUrl || "");
      setDescription(editSvc.description || "");
      setMatchUrl(editRule?.match.url || "");
      setMatchMethods(editRule?.match.methods || ["GET", "POST", "PUT", "PATCH", "DELETE"]);
      setStripPath(editRule?.stripPath || "");
      setSignIn(editRule ? signInFromAuthenticators(editRule.authenticators) : ['cookie']);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceDrawer?.mode, serviceDrawer?.serviceName]);

  // Late-arrival re-seed (root fix for "fields show empty by default" and the
  // Strip-path "empty" symptom). editRule is derived from the access-rules query
  // + service association; when the drawer opens BEFORE that resolves, the seed
  // above runs with editRule === null and match/methods/strip/upstream seed
  // empty and never repopulate (the primary effect excludes editRule from its
  // deps). Re-seed once the rule associates — keyed on editRule?.id so it fires
  // exactly when the id goes undefined→present, NOT on later optimistic content
  // edits (the id is stable across those). Gated on `pristine` so it can't wipe
  // changes the operator already started making.
  useEffect(() => {
    if (!isEdit || !editSvc || !editRule) return;
    if (!pristineRef.current) return;
    setUpstream(editSvc.upstreamUrl || "");
    setDescription(editSvc.description || "");
    setMatchUrl(editRule.match.url || "");
    setMatchMethods(editRule.match.methods || ["GET", "POST", "PUT", "PATCH", "DELETE"]);
    setStripPath(editRule.stripPath || "");
    setSignIn(signInFromAuthenticators(editRule.authenticators));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRule?.id]);

  if (!serviceDrawer) return null;

  const validName = /^[a-z0-9_-]+$/.test(name) && !state.services.some(s => s.name === name);
  const validUrl = /^https?:\/\//.test(upstream);

  const toggleMethod = (m: string) => {
    markDirty();
    setMatchMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  // Derive a sane match URL from the real upstream host rather than a bogus
  // example.io default that silently matches nothing (a "registered but
  // unreachable" trap).
  const deriveMatch = (up: string) => {
    try { return `<https?://${new URL(up).host}/.*>`; } catch { return `<https?://${name}/.*>`; }
  };

  const saveCreate = () => {
    if (!validName || !validUrl) return;
    const ok = applyChange("create", `service:${name} registered`, () => apiCreateService({
      name,
      displayName: description || undefined,
      upstreamUrl: upstream,
      matchUrl: matchUrl || deriveMatch(upstream),
      matchMethods,
      stripPath: stripPath || undefined,
      signIn,
    }));
    if (ok) setServiceDrawer(null);
  };

  const saveEdit = () => {
    if (!editSvc || !validUrl) return;
    const payload = {
      upstreamUrl: upstream,
      matchUrl: matchUrl || undefined,
      matchMethods: matchMethods.length ? matchMethods : undefined,
      stripPath: stripPath || null,
      signIn,
    };
    const ok = applyChange("update", `service:${editSvc.name} updated`, () => apiUpdateService(editSvc.name, payload));
    if (ok) setServiceDrawer(null);
  };

  const doDelete = () => {
    if (!editSvc) return;
    const svcName = editSvc.name;
    const ok = applyChange("delete", `service:${svcName} removed`, () => apiDeleteService(svcName));
    if (ok) { setServiceDrawer(null); setPage("services"); }
  };

  // NOTE: these are JSX expressions, NOT component declarations. Declaring a
  // child component INSIDE the render function gives it a fresh identity on
  // every parent render, which causes React to unmount/remount its DOM —
  // including any focused <input>. Using JSX values keeps the same elements
  // across renders so typing in the inputs no longer loses focus per char.
  const methodPicker = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {HTTP_METHODS.map(m => {
        const on = matchMethods.includes(m);
        return (
          <button key={m} onClick={() => toggleMethod(m)} style={{
            padding: "3px 10px", borderRadius: 20, fontSize: 11.5,
            fontFamily: "var(--font-mono, monospace)",
            border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
            background: on ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "transparent",
            color: on ? "var(--accent)" : "var(--ink-2)", cursor: "pointer",
          }}>{m}</button>
        );
      })}
    </div>
  );

  const toggleSignIn = (m: SignInMethod) => {
    markDirty();
    setSignIn(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  const signInPicker = (
    <div className="mb-12">
      <label className="input-label">Sign-in methods</label>
      {SIGN_IN_OPTIONS.map(o => {
        const locked = handlerCatalog ? !enabledAuthn.has(o.handler) : false;
        const on = signIn.includes(o.id);
        return (
          <label key={o.id} className="small" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.5 : 1 }}>
            <input type="checkbox" checked={on} disabled={locked} onChange={() => toggleSignIn(o.id)} style={{ marginTop: 2 }} />
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 500 }}>{o.label}</span>
              {locked && <span className="muted"> · not enabled on this gateway</span>}
              <span className="muted" style={{ display: 'block' }}>{o.hint}</span>
            </span>
          </label>
        );
      })}
      <div className="input-hint">
        {signIn.length === 0
          ? <span style={{ color: 'var(--warn, #d97706)' }}>None selected — the service is PUBLIC: no sign-in, no permission check.</span>
          : <>Tried in order: cookie → API token → OAuth2. The first matching credential wins; others are fallbacks.</>}
      </div>
    </div>
  );

  const sharedFields = (
    <>
      {signInPicker}
      <div className="mb-12">
        <label className="input-label">Where requests go *</label>
        <input className="input mono" value={upstream} onChange={e => { markDirty(); setUpstream(e.target.value); }} placeholder="http://service.namespace:8080" />
        <div className="input-hint">{upstream && !validUrl ? <span style={{ color: "var(--err)" }}>Must start with http:// or https://</span> : "The internal address the gateway forwards matching requests to."}</div>
      </div>
      <div className="mb-12">
        <label className="input-label">Public path <span className="muted">(optional)</span></label>
        <input className="input mono" value={matchUrl} onChange={e => { markDirty(); setMatchUrl(e.target.value); }} placeholder="<https?://api.example.io/svc/<**>>" />
        <div className="input-hint">Which public request URLs reach this service (regular expression). Leave empty to derive it from the address above.</div>
      </div>
      <div className="mb-12">
        <label className="input-label">Methods</label>
        {methodPicker}
        <div className="input-hint">HTTP methods this service accepts.</div>
      </div>
      <div className="mb-12">
        <label className="input-label">Strip path <span className="muted">(optional)</span></label>
        <input className="input mono" value={stripPath} onChange={e => { markDirty(); setStripPath(e.target.value); }} placeholder="/api/v1 — leave empty to keep the full path" />
        <div className="input-hint">Path prefix removed before forwarding to the service — leave empty to keep the full path.</div>
      </div>
    </>
  );

  if (isEdit) {
    return (
      <Drawer
        open={!!serviceDrawer}
        onClose={() => setServiceDrawer(null)}
        eyebrow="Edit service"
        title={`Edit · ${editSvc?.name}`}
        footer={
          <>
            <span className="small muted">Changes apply immediately.</span>
            <div className="row">
              <button className="btn" onClick={() => setServiceDrawer(null)}>Cancel</button>
              <button className="btn primary" onClick={saveEdit} disabled={!validUrl}>Save</button>
            </div>
          </>
        }
      >
        {sharedFields}
        <div className="mb-12">
          <label className="input-label">Description</label>
          <input className="input" value={description} onChange={e => { markDirty(); setDescription(e.target.value); }} placeholder="Short description" />
        </div>

        {editSvc && <ServiceRulesList svcName={editSvc.name} />}

        {/* Danger zone — hidden entirely for system services. The backend
            also enforces this (rbac.service.ts SystemResourceImmutable),
            but UI is the first line of defense. */}
        {editSvc?.system ? (
          <div className="panel" style={{ padding: 14, marginTop: 8 }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>🔒 System service</div>
            <div className="small muted">
              <span className="mono">{editSvc.name}</span> is bootstrap-protected and cannot be deleted. Removing it would break the platform's RBAC plumbing.
            </div>
          </div>
        ) : (
          <div className="panel" style={{ padding: 14, marginTop: 8 }}>
            <div style={{ fontWeight: 500, marginBottom: 4, color: "var(--red, #ef4444)" }}>Delete service</div>
            <div className="small muted" style={{ marginBottom: 10 }}>
              Removes all roles, routes, Oathkeeper rules, and group assignments for <span className="mono">{editSvc?.name}</span>. Cannot be undone.
            </div>
            {!confirmDelete
              ? (
                <button className="btn" style={{ borderColor: "var(--red, #ef4444)", color: "var(--red, #ef4444)" }} onClick={() => setConfirmDelete(true)}>
                  Delete service
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="small" style={{ flex: 1, color: "var(--red, #ef4444)" }}>Delete {editSvc?.name} and all its data?</span>
                  <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  <button className="btn primary" style={{ background: "var(--red, #ef4444)", borderColor: "var(--red, #ef4444)" }} onClick={doDelete}>Delete</button>
                </div>
              )}
          </div>
        )}
      </Drawer>
    );
  }

  return (
    <Drawer
      open={!!serviceDrawer}
      onClose={() => setServiceDrawer(null)}
      eyebrow="New service"
      title="Register service"
      footer={
        <>
          <span className="small muted">Also creates the service's role set and gateway rule.</span>
          <div className="row">
            <button className="btn" onClick={() => setServiceDrawer(null)}>Cancel</button>
            <button className="btn primary" onClick={saveCreate} disabled={!validName || !validUrl}>Register</button>
          </div>
        </>
      }
    >
      <div className="mb-12">
        <label className="input-label">Service ID *</label>
        <input className="input mono" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. reporting" />
        <div className="input-hint">{name && !validName ? <span style={{ color: "var(--err)" }}>Invalid or already exists</span> : "A short id used everywhere this service is referenced — lowercase letters, numbers, underscores and hyphens."}</div>
      </div>
      {sharedFields}
      <div className="mb-12">
        <label className="input-label">Description</label>
        <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
      </div>
      {/* State the security outcome so a non-technical creator knows what they get. */}
      <div className="panel" style={{ padding: "10px 12px", display: "flex", gap: 8, alignItems: "center" }}>
        {signIn.length === 0 ? (
          <>
            <Chip tone="warn" mono={false}>Public</Chip>
            <span className="small muted">Created <b>Public</b> — anyone can reach it, no sign-in or permission check. Fine-tune in the service's Gateway tab.</span>
          </>
        ) : (
          <>
            <Chip tone="ok" mono={false}>Protected</Chip>
            <span className="small muted">Created <b>Protected</b> — callers sign in via {signIn.map(m => SIGN_IN_OPTIONS.find(o => o.id === m)?.label).join(' or ')}, permissions checked by OPA. Fine-tune in the Gateway tab.</span>
          </>
        )}
      </div>
    </Drawer>
  );
}
