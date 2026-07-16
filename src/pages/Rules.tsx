import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { Chip, Method, RulePipeline } from '../components/ui/Primitives';
import { I } from '../components/ui/Icons';
import { useApplyChange } from '../hooks/useApplyChange';

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

// Humanise the raw Ory authorizer handler into a status + a plain-language
// explanation of WHY it's that status (surfaced as a tooltip, so the colour is
// never unexplained).
function authzStatus(a: string): { label: string; tone: string; hint: string } {
  if (a === 'allow') return { label: 'Open · no permission check', tone: 'warn', hint: 'Any request matching this rule passes straight through — the gateway performs no permission check.' };
  if (a === 'deny') return { label: 'Blocked', tone: 'err', hint: 'Every request matching this rule is rejected at the gateway.' };
  return { label: 'Protected · permission checked', tone: 'ok', hint: 'Requests are checked against the permission policy before they reach the service.' };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <div className="mono small" style={{ color: 'var(--ink-2)', wordBreak: 'break-all' }}>{children}</div>
    </div>
  );
}

export function RulesPage({ svc, embedded = false }: { svc?: string; embedded?: boolean } = {}) {
  const { state, apiUpdateService } = useApp();
  const applyChange = useApplyChange();
  const rules = svc ? state.accessRules.filter(r => r.service === svc) : state.accessRules;
  const [selectedId, setSelectedId] = useState(rules[0]?.id);
  const rule = rules.find(r => r.id === selectedId) || rules[0];

  // Match + upstream are editable here (for a regular service) by writing
  // through the service-update path, which regenerates the gateway rule
  // server-side — avoiding the lossy raw-rule round-trip. System services are
  // platform plumbing → read-only. Authentication/authorization stay read-only
  // (they're the platform-incident foot-guns; managed via infrastructure).
  const svcObj = state.services.find(s => s.name === (svc ?? rule?.service));
  const canEdit = embedded && !!svc && svc !== 'global' && !svcObj?.system;

  const [editing, setEditing] = useState(false);
  const [dMethods, setDMethods] = useState<string[]>([]);
  const [dUrl, setDUrl] = useState('');
  const [dUpstream, setDUpstream] = useState('');
  useEffect(() => { setEditing(false); }, [selectedId, svc]);

  const startEdit = () => {
    if (!rule) return;
    setDMethods(rule.match.methods);
    setDUrl(rule.match.url);
    setDUpstream(rule.upstream || '');
    setEditing(true);
  };
  const toggleMethod = (m: string) => setDMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  const validUpstream = /^https?:\/\//.test(dUpstream);
  const save = () => {
    if (!svc || !validUpstream || dMethods.length === 0) return;
    const stripPath = (rule as { stripPath?: string } | undefined)?.stripPath;
    applyChange('update', `gateway: ${svc} · routing`, () =>
      apiUpdateService(svc, { upstreamUrl: dUpstream, matchUrl: dUrl, matchMethods: dMethods, stripPath: stripPath ?? undefined }),
    );
    setEditing(false);
  };

  return (
    <>
      {!embedded && (
        <div className="page-head">
          <div>
            <h1>Gateway routing</h1>
            <div className="sub">How the gateway routes and protects each service · read-only</div>
          </div>
        </div>
      )}

      <div className="panel mb-12" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 15, height: 15, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', flexShrink: 0 }}>{I.info}</span>
        <span className="small muted">
          {canEdit
            ? <>Match &amp; upstream regenerate this service's gateway rule when you save. Authentication &amp; authorization are managed by your infrastructure.</>
            : svcObj?.system
              ? <>System service — its gateway rule is managed by the platform (read-only).</>
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
            {rules.map(r => {
              const s = authzStatus(r.authorizer);
              return (
                <button key={r.id} onClick={() => setSelectedId(r.id)} style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid var(--line)", background: r.id === rule?.id ? "var(--panel-2)" : "transparent", color: "var(--ink)", cursor: "pointer" }}>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: r.id === rule?.id ? 600 : 500 }}>{embedded ? r.id : r.service}</div>
                  <div className="small mt-4"><Chip tone={s.tone} title={s.hint}>{s.label}</Chip></div>
                </button>
              );
            })}
          </div>
          {rule && (
            <div className="panel">
              <div className="panel-head">
                <div style={{ minWidth: 0, flex: 1 }}><h3><span className="mono">{rule.service}</span></h3><div className="sub">Affects all matching requests to this service</div></div>
                <div className="row" style={{ gap: 8 }}>
                  <Chip tone={authzStatus(rule.authorizer).tone} title={authzStatus(rule.authorizer).hint}>{authzStatus(rule.authorizer).label}</Chip>
                  {canEdit && (editing ? (
                    <>
                      <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
                      <button className="btn primary sm" onClick={save} disabled={!validUpstream || dMethods.length === 0}>Save</button>
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
                {rule.authorizer === "allow" && (
                  <div className="small" style={{ color: "var(--warn)", display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.alert}</span>
                    Every request matching this rule is authorized with no permission check.
                  </div>
                )}

                {/* Matches — editable (methods + URL) */}
                <div>
                  <label className="input-label">Matches</label>
                  {editing ? (
                    <>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {ALL_METHODS.map(m => {
                          const on = dMethods.includes(m);
                          return <button key={m} onClick={() => toggleMethod(m)} className="chip" style={{ cursor: 'pointer', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 11, background: on ? 'var(--accent)' : 'var(--panel-2)', color: on ? '#fff' : 'var(--ink-2)', borderColor: on ? 'var(--accent)' : 'var(--line)' }}>{m}</button>;
                        })}
                      </div>
                      <input className="input mono" value={dUrl} onChange={e => setDUrl(e.target.value)} style={{ width: '100%' }} placeholder="match URL (regexp)" />
                    </>
                  ) : (
                    <div className="mono small" style={{ color: 'var(--ink-2)', wordBreak: 'break-all' }}>{rule.match.methods.join(', ')} &nbsp;{rule.match.url}</div>
                  )}
                </div>

                <Field label="Authentication">{rule.authenticators.length ? rule.authenticators.join(', ') : 'none'}</Field>
                <Field label="Authorization"><span title={authzStatus(rule.authorizer).hint}>{authzStatus(rule.authorizer).label}</span>{rule.authorizer === 'remote_json' && rule.opaUrl ? <> · <span className="muted">policy engine</span></> : null}</Field>

                {/* Forwards to — editable */}
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
    </>
  );
}
