import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { Chip, Method, RulePipeline, ConfirmDialog } from '../components/ui/Primitives';
import { I } from '../components/ui/Icons';
import { useApplyChange } from '../hooks/useApplyChange';
import { useUpdateAccessRule } from '../api/hooks';
import type { JinbeAccessRule } from '../api/client';

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const AUTHN = ['cookie_session', 'bearer_token', 'noop'];
const AUTHN_LABEL: Record<string, string> = { cookie_session: 'Session (cookie)', bearer_token: 'Bearer token', noop: 'None' };
const AUTHZ: { v: string; label: string; tone: string }[] = [
  { v: 'remote_json', label: 'Protected', tone: 'ok' },
  { v: 'allow', label: 'Open', tone: 'warn' },
  { v: 'deny', label: 'Blocked', tone: 'err' },
];
const isNoAuth = (a: string[]) => a.length === 0 || a.every(x => x === 'noop');

// Humanise the raw Ory authorizer handler into a status + a plain-language
// explanation of WHY it's that status (surfaced as a tooltip).
function authzStatus(a: string): { label: string; tone: string; hint: string } {
  if (a === 'allow') return { label: 'Open · no permission check', tone: 'warn', hint: 'Any request matching this rule passes straight through — the gateway performs no permission check.' };
  if (a === 'deny') return { label: 'Blocked', tone: 'err', hint: 'Every request matching this rule is rejected at the gateway.' };
  return { label: 'Protected · permission checked', tone: 'ok', hint: 'Requests are checked against the permission policy before they reach the service.' };
}

// A service's HTTP surface is split across several gateway rules; turn the raw
// id suffix ("kuma-api-preflight") into a human role.
function ruleLabel(id: string, svc?: string): string {
  const suffix = !svc || id === svc ? '' : id.replace(new RegExp(`^${svc}[-_]?`), '');
  const map: Record<string, string> = {
    '': 'Base', api: 'API', 'api-preflight': 'Preflight (CORS)', preflight: 'Preflight (CORS)',
    app: 'App', ui: 'UI', settings: 'Settings', public: 'Public', root: 'Root',
    dsn: 'Database', studio: 'Studio', engine: 'Engine',
  };
  return map[suffix] ?? (suffix ? suffix.charAt(0).toUpperCase() + suffix.slice(1).replace(/[-_]/g, ' ') : 'Base');
}

// Small segmented / chip toggle used by the inline editor.
function Toggle({ on, tone, onClick, children }: { on: boolean; tone?: string; onClick: () => void; children: React.ReactNode }) {
  const c = tone === 'warn' ? 'var(--warn)' : tone === 'err' ? 'var(--red, #ef4444)' : 'var(--accent)';
  return (
    <button onClick={onClick} className="chip" style={{
      cursor: 'pointer', fontWeight: 500, fontSize: 11.5,
      background: on ? c : 'var(--panel-2)', color: on ? '#fff' : 'var(--ink-2)', borderColor: on ? c : 'var(--line)',
    }}>{children}</button>
  );
}

export function RulesPage({ svc, unassigned = false }: { svc?: string; unassigned?: boolean } = {}) {
  const { state } = useApp();
  const applyChange = useApplyChange();
  const updateRule = useUpdateAccessRule();
  const registered = new Set(state.services.map(s => s.name));
  const rules = unassigned
    ? state.accessRules.filter(r => !registered.has(r.service))
    : svc ? state.accessRules.filter(r => r.service === svc) : state.accessRules;
  const [selectedId, setSelectedId] = useState(rules[0]?.id);
  const rule = rules.find(r => r.id === selectedId) || rules[0];

  const svcObj = state.services.find(s => s.name === (svc ?? rule?.service));
  // Per-rule editing targets ONE rule by id (safe on multi-rule services). Only
  // regular, registered, non-system services are editable; infra/system are
  // read-only. Each field is overlaid on the raw rule so nothing is dropped.
  const canEdit = !!svc && svc !== 'global' && !svcObj?.system && !unassigned;

  const [editing, setEditing] = useState(false);
  const [dMethods, setDMethods] = useState<string[]>([]);
  const [dUrl, setDUrl] = useState('');
  const [dUpstream, setDUpstream] = useState('');
  const [dAuth, setDAuth] = useState<string[]>([]);
  const [dAuthz, setDAuthz] = useState('remote_json');
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => { setEditing(false); }, [selectedId, svc]);

  const startEdit = () => {
    if (!rule) return;
    setDMethods(rule.match.methods);
    setDUrl(rule.match.url);
    setDUpstream(rule.upstream || '');
    setDAuth(rule.authenticators);
    setDAuthz(rule.authorizer);
    setEditing(true);
  };
  const toggle = (arr: string[], set: (v: string[]) => void, m: string) => set(arr.includes(m) ? arr.filter(x => x !== m) : [...arr, m]);
  const validUpstream = /^https?:\/\//.test(dUpstream);
  const canSave = validUpstream && dMethods.length > 0;

  const buildMerged = (): JinbeAccessRule => {
    const raw = rule!.raw as JinbeAccessRule;
    const authenticators = dAuth.map(h => raw.authenticators.find(a => a.handler === h) ?? { handler: h });
    let authorizer: JinbeAccessRule['authorizer'];
    if (dAuthz === raw.authorizer.handler) authorizer = raw.authorizer;
    else if (dAuthz === 'remote_json') authorizer = { handler: 'remote_json', config: rule!.opaUrl ? { remote_json_url: rule!.opaUrl } : undefined };
    else authorizer = { handler: dAuthz };
    return {
      ...raw,
      match: { ...raw.match, url: dUrl, methods: dMethods },
      authenticators,
      authorizer,
      upstream: { ...(raw.upstream || {}), url: dUpstream },
    };
  };

  // Flipping to Open (no permission check) or dropping sign-in is a
  // platform-incident-class change — gate it behind a confirm.
  const dangerous = !!rule && (
    (dAuthz === 'allow' && rule.authorizer !== 'allow') ||
    (isNoAuth(dAuth) && !isNoAuth(rule.authenticators))
  );

  const doSave = () => {
    if (!rule || !canSave) return;
    applyChange('update', `gateway: ${rule.id}`, () => updateRule.mutateAsync({ id: rule.id, rule: buildMerged() }).then(() => undefined));
    setEditing(false);
    setConfirmOpen(false);
  };
  const onSaveClick = () => { if (dangerous) setConfirmOpen(true); else doSave(); };

  return (
    <>
      <div className="panel mb-12" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 15, height: 15, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', flexShrink: 0 }}>{I.info}</span>
        <span className="small muted">
          {unassigned
            ? <>These gateway rules aren't tied to a registered service (infrastructure or legacy rules) — read-only.</>
            : canEdit
              ? <>Edit any rule's protection, sign-in, match and upstream below. Changes apply to this rule only.</>
              : svcObj?.system
                ? <>System service — its gateway rules are managed by the platform (read-only).</>
                : <>Generated from your services and version-controlled — read-only.</>}
        </span>
      </div>

      {rules.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
          <div className="muted small">No gateway rules{svc ? <> for <span className="mono">{svc}</span></> : ''}.</div>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "300px 1fr", gap: 14 }}>
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)" }}>{svc ? `${rules.length} rule${rules.length !== 1 ? 's' : ''}` : 'Rules'}</div>
            {!unassigned && rules.length > 1 && (
              <div className="small muted" style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)", lineHeight: 1.5 }}>
                This service's surface is split into {rules.length} rules (e.g. CORS preflight, the protected API, the app) — each matches its own paths and is protected independently.
              </div>
            )}
            {rules.map(r => {
              const s = authzStatus(r.authorizer);
              return (
                <button key={r.id} onClick={() => setSelectedId(r.id)} style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid var(--line)", background: r.id === rule?.id ? "var(--panel-2)" : "transparent", color: "var(--ink)", cursor: "pointer" }}>
                  <div className={unassigned ? "mono" : undefined} style={{ fontSize: 12.5, fontWeight: r.id === rule?.id ? 600 : 500 }}>{unassigned ? r.id : ruleLabel(r.id, svc)}</div>
                  <div className="small mt-4"><Chip tone={s.tone} title={s.hint}>{s.label}</Chip></div>
                </button>
              );
            })}
          </div>
          {rule && (
            <div className="panel">
              <div className="panel-head">
                <div style={{ minWidth: 0, flex: 1 }}><h3>{unassigned ? <span className="mono">{rule.id}</span> : ruleLabel(rule.id, svc)}</h3><div className="sub">Matches these methods &amp; paths, then forwards to the service</div></div>
                <div className="row" style={{ gap: 8 }}>
                  <Chip tone={authzStatus(rule.authorizer).tone} title={authzStatus(rule.authorizer).hint}>{authzStatus(rule.authorizer).label}</Chip>
                  {canEdit && (editing ? (
                    <>
                      <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
                      <button className="btn primary sm" onClick={onSaveClick} disabled={!canSave}>Save</button>
                    </>
                  ) : (
                    <button className="btn sm" onClick={startEdit}><span style={{ width: 13, height: 13, display: 'grid', placeItems: 'center' }}>{I.edit}</span> Edit</button>
                  ))}
                </div>
              </div>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
                <RulePipeline rule={rule} />
              </div>
              <div className="panel-body col" style={{ gap: 16 }}>
                {!editing && rule.authorizer === "allow" && (
                  <div className="small" style={{ color: "var(--warn)", display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.alert}</span>
                    Every request matching this rule is authorized with no permission check.
                  </div>
                )}

                {/* Authorization */}
                <div>
                  <label className="input-label">Authorization</label>
                  {editing ? (
                    <div className="row" style={{ gap: 6 }}>
                      {AUTHZ.map(a => <Toggle key={a.v} on={dAuthz === a.v} tone={a.tone} onClick={() => setDAuthz(a.v)}>{a.label}</Toggle>)}
                    </div>
                  ) : (
                    <div className="small" title={authzStatus(rule.authorizer).hint}>{authzStatus(rule.authorizer).label}{rule.authorizer === 'remote_json' && rule.opaUrl ? <> · <span className="muted">policy engine</span></> : null}</div>
                  )}
                </div>

                {/* Authentication */}
                <div>
                  <label className="input-label">Sign-in required</label>
                  {editing ? (
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {AUTHN.map(a => <Toggle key={a} on={dAuth.includes(a)} onClick={() => toggle(dAuth, setDAuth, a)}>{AUTHN_LABEL[a]}</Toggle>)}
                    </div>
                  ) : (
                    <div className="mono small" style={{ color: 'var(--ink-2)' }}>{rule.authenticators.length ? rule.authenticators.map(a => AUTHN_LABEL[a] || a).join(', ') : 'None'}</div>
                  )}
                </div>

                {/* Matches */}
                <div>
                  <label className="input-label">Matches</label>
                  {editing ? (
                    <>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {ALL_METHODS.map(m => <Toggle key={m} on={dMethods.includes(m)} onClick={() => toggle(dMethods, setDMethods, m)}>{m}</Toggle>)}
                      </div>
                      <input className="input mono" value={dUrl} onChange={e => setDUrl(e.target.value)} style={{ width: '100%' }} placeholder="match URL (regexp)" />
                    </>
                  ) : (
                    <div className="mono small" style={{ color: 'var(--ink-2)', wordBreak: 'break-all' }}>{rule.match.methods.join(', ')} &nbsp;{rule.match.url}</div>
                  )}
                </div>

                {/* Forwards to */}
                <div>
                  <label className="input-label">Forwards to</label>
                  {editing ? (
                    <>
                      <input className="input mono" value={dUpstream} onChange={e => setDUpstream(e.target.value)} style={{ width: '100%' }} placeholder="http://service:port" />
                      {dUpstream && !validUpstream && <div className="input-hint" style={{ color: 'var(--err)' }}>Must start with http:// or https://</div>}
                    </>
                  ) : (
                    <div className="mono small" style={{ color: 'var(--ink-2)', wordBreak: 'break-all' }}>{rule.upstream || '—'}</div>
                  )}
                </div>

                {/* Routes preview (read-only) */}
                {state.routeMaps[rule.service] && (
                  <div>
                    <label className="input-label">Routes · {state.routeMaps[rule.service].length}</label>
                    <div className="panel" style={{ padding: 0, maxHeight: 180, overflowY: "auto" }}>
                      {state.routeMaps[rule.service].map((r, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, padding: "8px 12px", alignItems: "center", borderBottom: i < state.routeMaps[rule.service].length - 1 ? "1px solid var(--line)" : "none" }}>
                          <Method m={r.method} />
                          <span className="mono small" style={{ flex: 1 }}>{r.path}</span>
                          {r.permission ? <Chip>{r.permission}</Chip> : <Chip tone="info" title="Reachable with no permission — public">public</Chip>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Reduce protection on this rule?"
        danger
        confirmLabel="Apply anyway"
        body={<>
          {dAuthz === 'allow' && rule?.authorizer !== 'allow' && <div>Setting <b>Open</b> means every matching request is allowed with <b>no permission check</b>.</div>}
          {isNoAuth(dAuth) && rule && !isNoAuth(rule.authenticators) && <div style={{ marginTop: 6 }}>Removing sign-in means requests won't need to be authenticated.</div>}
        </>}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doSave}
      />
    </>
  );
}
