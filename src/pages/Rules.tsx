import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Chip, Method, RulePipeline } from '../components/ui/Primitives';
import { useApplyChange } from '../hooks/useApplyChange';
import { useUpdateAccessRule } from '../api/hooks';
import type { AccessRule } from '../api/types';

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

function uiToJinbe(r: AccessRule) {
  return {
    id: r.id,
    upstream: { url: r.upstream || '' },
    match: r.match,
    authenticators: r.authenticators.map(h => ({ handler: h })),
    authorizer: r.authorizer === 'remote_json' && r.opaUrl
      ? { handler: 'remote_json', config: { remote_json_url: r.opaUrl } }
      : { handler: r.authorizer },
    mutators: r.mutators.map(h => ({ handler: h })),
  } as import('../api/client').JinbeAccessRule;
}

export function RulesPage() {
  const { state, setState, isLive } = useApp();
  const applyChange = useApplyChange();
  const updateRule = useUpdateAccessRule();
  const [selectedId, setSelectedId] = useState(state.accessRules[0]?.id);
  const rule = state.accessRules.find(r => r.id === selectedId) || state.accessRules[0];

  // Draft state for inline text edits
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [draftUpstream, setDraftUpstream] = useState<string | null>(null);

  const patchRule = (patch: Partial<AccessRule>, summary: string) => {
    if (!rule) return;
    const updated = { ...rule, ...patch };
    applyChange('update', summary, () => {
      setState(s => ({ ...s, accessRules: s.accessRules.map(r => r.id === rule.id ? updated : r) }));
    });
    if (isLive) updateRule.mutate({ id: rule.id, rule: uiToJinbe(updated) });
  };

  const commitUrl = () => {
    if (draftUrl !== null && draftUrl !== rule?.match.url) {
      patchRule({ match: { ...rule!.match, url: draftUrl } }, `oathkeeper: ${rule!.id} · url`);
    }
    setDraftUrl(null);
  };

  const commitUpstream = () => {
    if (draftUpstream !== null && draftUpstream !== rule?.upstream) {
      patchRule({ upstream: draftUpstream }, `oathkeeper: ${rule!.id} · upstream`);
    }
    setDraftUpstream(null);
  };

  const toggleMethod = (m: string) => {
    if (!rule) return;
    const methods = rule.match.methods.includes(m)
      ? rule.match.methods.filter(x => x !== m)
      : [...rule.match.methods, m];
    if (methods.length === 0) return; // need at least one
    patchRule({ match: { ...rule.match, methods } }, `oathkeeper: ${rule.id} · methods`);
  };

  const toggleAuthenticator = (a: string) => {
    if (!rule) return;
    const authenticators = rule.authenticators.includes(a)
      ? rule.authenticators.filter(x => x !== a)
      : [...rule.authenticators, a];
    patchRule({ authenticators }, `oathkeeper: ${rule.id} · authenticator ${a}`);
  };

  const setAuthorizer = (val: string) => {
    if (!rule) return;
    patchRule({ authorizer: val }, `oathkeeper: ${rule.id} · authorizer=${val}`);
  };

  const urlVal = draftUrl !== null ? draftUrl : (rule?.match.url ?? '');
  const upstreamVal = draftUpstream !== null ? draftUpstream : (rule?.upstream ?? '');

  return (
    <>
      <div className="page-head"><div><h1>Oathkeeper rules</h1><div className="sub">Gateway-level routing</div></div></div>
      <div className="grid" style={{ gridTemplateColumns: "300px 1fr", gap: 14 }}>
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)" }}>Rules</div>
          {state.accessRules.map(r => (
            <button key={r.id} onClick={() => { setSelectedId(r.id); setDraftUrl(null); setDraftUpstream(null); }} style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid var(--line)", background: r.id === rule?.id ? "var(--panel-2)" : "transparent", color: "var(--ink)", cursor: "pointer" }}>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: r.id === rule?.id ? 600 : 500 }}>{r.id}</div>
              <div className="small muted mono mt-4">{r.service} → {r.authorizer}</div>
            </button>
          ))}
        </div>
        {rule && (
          <div className="panel">
            <div className="panel-head">
              <div style={{ minWidth: 0, flex: 1 }}><h3><span className="mono">{rule.id}</span></h3><div className="sub">service: <span className="mono">{rule.service}</span></div></div>
              <Chip tone={rule.authorizer === "allow" ? "info" : "ok"}>{rule.authorizer}</Chip>
            </div>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
              <RulePipeline rule={rule} />
            </div>
            <div className="panel-body col" style={{ gap: 16 }}>

              {/* Match URL */}
              <div>
                <label className="input-label">Match URL</label>
                <input
                  className="input mono"
                  value={urlVal}
                  onChange={e => setDraftUrl(e.target.value)}
                  onBlur={commitUrl}
                  onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setDraftUrl(null); } }}
                  style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                />
              </div>

              {/* Methods */}
              <div>
                <label className="input-label">Methods</label>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {ALL_METHODS.map(m => {
                    const on = rule.match.methods.includes(m);
                    return (
                      <button key={m} onClick={() => toggleMethod(m)} className="chip" style={{ cursor: "pointer", fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 11, background: on ? "var(--accent)" : "var(--panel-2)", color: on ? "white" : "var(--ink-2)", borderColor: on ? "var(--accent)" : "var(--line)" }}>
                        {m}
                      </button>
                    );
                  })}
                </div>
                <div className="input-hint">Click to toggle. At least one required.</div>
              </div>

              {/* Authenticators */}
              <div>
                <label className="input-label">Authenticators</label>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {["cookie_session", "bearer_token", "noop"].map(a => {
                    const on = rule.authenticators.includes(a);
                    return (
                      <button key={a} onClick={() => toggleAuthenticator(a)} className="chip" style={{ cursor: "pointer", fontWeight: 500, background: on ? "var(--accent)" : "var(--panel-2)", color: on ? "white" : "var(--ink-2)", borderColor: on ? "var(--accent)" : "var(--line)" }}>
                        {on && "✓ "}{a}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Authorizer */}
              <div>
                <label className="input-label">Authorizer</label>
                <div className="row" style={{ gap: 6 }}>
                  {["remote_json", "allow", "deny"].map(a => (
                    <button key={a} onClick={() => setAuthorizer(a)} className="chip" style={{ cursor: "pointer", fontWeight: 500, background: rule.authorizer === a ? "var(--ink)" : "var(--panel-2)", color: rule.authorizer === a ? "var(--bg)" : "var(--ink-2)", borderColor: rule.authorizer === a ? "var(--ink)" : "var(--line)" }}>
                      {a}
                    </button>
                  ))}
                </div>
                {rule.authorizer === "remote_json" && rule.opaUrl && <div className="input-hint">OPA URL: <span className="mono">{rule.opaUrl}</span></div>}
                {rule.authorizer === "allow" && <div className="input-hint" style={{ color: "var(--warn)" }}>Any request matching this rule is authorized — no permission check.</div>}
              </div>

              {/* Upstream */}
              <div>
                <label className="input-label">Upstream URL</label>
                <input
                  className="input mono"
                  value={upstreamVal}
                  onChange={e => setDraftUpstream(e.target.value)}
                  onBlur={commitUpstream}
                  onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setDraftUpstream(null); } }}
                  style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                  placeholder="http://service:port"
                />
              </div>

              {/* Routes preview */}
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
    </>
  );
}
