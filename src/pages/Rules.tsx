import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Chip, Method, RulePipeline } from '../components/ui/Primitives';
import { I } from '../components/ui/Icons';

// Humanise the raw Ory authorizer handler into a status an operator can read.
function authzStatus(a: string): { label: string; tone: string } {
  if (a === 'allow') return { label: 'Open · no permission check', tone: 'warn' };
  if (a === 'deny') return { label: 'Blocked', tone: 'err' };
  return { label: 'Protected · permission checked', tone: 'ok' };
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
  const { state } = useApp();
  const rules = svc ? state.accessRules.filter(r => r.service === svc) : state.accessRules;
  const [selectedId, setSelectedId] = useState(rules[0]?.id);
  const rule = rules.find(r => r.id === selectedId) || rules[0];

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

      {/* These rules are generated from Services and version-controlled (GitOps).
          Editing them by hand here is a platform-wide operation, so the surface
          is read-only — authoring happens in Services / infrastructure. */}
      <div className="panel mb-12" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 15, height: 15, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', flexShrink: 0 }}>{I.info}</span>
        <span className="small muted">Generated from {svc ? <>the <span className="mono">{svc}</span> service</> : 'your services'} and version-controlled. To change routing, edit the service or your infrastructure.</span>
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
                  <div className="small mt-4"><Chip tone={s.tone}>{s.label}</Chip></div>
                </button>
              );
            })}
          </div>
          {rule && (
            <div className="panel">
              <div className="panel-head">
                <div style={{ minWidth: 0, flex: 1 }}><h3><span className="mono">{rule.service}</span></h3><div className="sub">Affects all matching requests to this service</div></div>
                <Chip tone={authzStatus(rule.authorizer).tone}>{authzStatus(rule.authorizer).label}</Chip>
              </div>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
                <RulePipeline rule={rule} />
              </div>
              <div className="panel-body col" style={{ gap: 16 }}>
                {rule.authorizer === "allow" && (
                  <div className="small" style={{ color: "var(--warn)", display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>{I.alert}</span>
                    Every request matching this rule is authorized with no permission check. Review in Services.
                  </div>
                )}

                <Field label="Matches">{rule.match.methods.join(', ')} &nbsp;{rule.match.url}</Field>
                <Field label="Authentication">{rule.authenticators.length ? rule.authenticators.join(', ') : 'none'}</Field>
                <Field label="Authorization">{authzStatus(rule.authorizer).label}{rule.authorizer === 'remote_json' && rule.opaUrl ? <> · <span className="muted">policy engine</span></> : null}</Field>
                <Field label="Forwards to">{rule.upstream || '—'}</Field>

                {/* Routes preview (read-only) */}
                {state.routeMaps[rule.service] && (
                  <div>
                    <label className="input-label">Routes · {state.routeMaps[rule.service].length}</label>
                    <div className="panel" style={{ padding: 0, maxHeight: 180, overflowY: "auto" }}>
                      {state.routeMaps[rule.service].map((r, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, padding: "8px 12px", alignItems: "center", borderBottom: i < state.routeMaps[rule.service].length - 1 ? "1px solid var(--line)" : "none" }}>
                          <Method m={r.method} />
                          <span className="mono small" style={{ flex: 1 }}>{r.path}</span>
                          {r.permission ? <Chip>{r.permission}</Chip> : <Chip tone="info">public</Chip>}
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
