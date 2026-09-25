import React, { useState } from 'react';
import { I } from './Icons';
import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { EmptyHint } from './EmptyState';
import { cx } from './cx';
import { LevelMeta } from '../../hooks/useRbac';
import { permissionChain, type RouteTable } from '../../policy/model';

export function Method({ m }: { m: string }) {
  return <span className={`method ${m}`}>{m}</span>;
}

// Toggle-chip multi-select (same visual language as the Groups role picker).
// `selected` is the current set; clicking a pill toggles it via `onToggle`.
// Kept generic so the org→service bundle editor and any future set-picker share
// one accessible control (aria-pressed reflects state).
export function MultiSelectPills({ options, selected, onToggle, empty }: {
  options: string[]; selected: string[]; onToggle: (value: string) => void; empty?: React.ReactNode;
}) {
  if (options.length === 0) {
    return <div className="small muted">{empty ?? "No options available."}</div>;
  }
  return (
    <div className="pills">
      {options.map(o => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            className={cx("pill", on && "on")}
            aria-pressed={on}
            onClick={() => onToggle(o)}
          >
            {on && <span className="kv-ico">{I.check}</span>} {o}
          </button>
        );
      })}
    </div>
  );
}

export function AccessLevel({ level, count, compact = false }: { level: string; count?: number; compact?: boolean }) {
  const m = LevelMeta[level] || LevelMeta.none;
  return (
    <span className={`alevel l-${level} ${compact ? "compact" : ""}`} title={m.desc}>
      <span className="bars" aria-hidden="true">
        {[0, 1, 2, 3, 4].map(i => <span key={i} className={`bar ${i <= m.order ? "on" : ""}`} />)}
      </span>
      {!compact && <span className="lbl">{m.label}</span>}
      {count != null && !compact && <span className="cnt">{count}</span>}
    </span>
  );
}

// The gateway request pipeline, rendered as plain-language stages with a status
// colour each (Layer 2). When `onNodeClick` is supplied the nodes become
// buttons that open the per-stage editor; `activeStage` highlights the node
// currently being edited. `errors` carries the rule's error-handler names so
// the Errors node can reflect "Default" vs "Custom".
export function RulePipeline({ rule, errors, onNodeClick, activeStage }: {
  rule: { match: { methods: string[] }; authenticators: string[]; authorizer: string; mutators: string[]; upstream?: string };
  errors?: string[];
  onNodeClick?: (stage: string) => void;
  activeStage?: string | null;
}) {
  const realAuthn = rule.authenticators.filter(a => a !== "noop" && a !== "anonymous" && a !== "unauthorized");
  const realMutators = rule.mutators.filter(m => m !== "noop");
  const realErrors = (errors ?? []).filter(e => e !== "noop");
  const authz = rule.authorizer;
  const host = rule.upstream ? (() => { try { return new URL(rule.upstream!).host; } catch { return rule.upstream!; } })() : "\u2014";
  const stages = [
    { k: "match",    label: "Match",      sub: rule.match.methods.join("\u00b7") || "any", mono: true,  icon: I.route,  tone: "" },
    { k: "authn",    label: "Sign-in",    sub: realAuthn.length ? "Required" : "Not required", mono: false, icon: realAuthn.length ? I.lock : I.globe, tone: realAuthn.length ? "ok" : "warn" },
    { k: "authz",    label: "Permission", sub: authz === "deny" ? "Blocked" : authz === "allow" ? "Not checked" : "Checked", mono: false, icon: authz === "deny" ? I.close : authz === "allow" ? I.alert : I.shield, tone: authz === "deny" ? "err" : authz === "allow" ? "warn" : "ok" },
    { k: "mutate",   label: "Headers",    sub: realMutators.length ? `${realMutators.length} added` : "Default", mono: false, icon: I.edit, tone: "" },
    { k: "errors",   label: "Errors",     sub: realErrors.length ? "Custom" : "Default", mono: false, icon: I.alert, tone: "" },
    { k: "upstream", label: "Send",       sub: host, mono: true, icon: I.box, tone: "ok" },
  ];
  const clickable = !!onNodeClick;
  return (
    <div className="rulepipe">
      {stages.map((st, i) => {
        const cls = `rp-node rp-${st.k}${st.tone ? ` tone-${st.tone}` : ""}${clickable ? " clickable" : ""}${activeStage === st.k ? " active" : ""}`;
        const inner = (
          <>
            <span className="rp-ico">{st.icon}</span>
            <div className="rp-txt">
              <span className="rp-lbl">{st.label}</span>
              <span className={`rp-sub${st.mono ? " mono" : ""}`}>{st.sub}</span>
            </div>
          </>
        );
        return (
          <React.Fragment key={st.k}>
            {clickable
              ? <button type="button" className={cls} onClick={() => onNodeClick!(st.k)} aria-label={`Edit ${st.label}`}>{inner}</button>
              : <div className={cls}>{inner}</div>}
            {i < stages.length - 1 && <span className="rp-arrow" aria-hidden="true">{"\u203a"}</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// A numbered, rail-connected accordion row for the vertical gateway pipeline.
// Collapsed it shows the stage's current value in plain words + a status tone;
// clicking the header expands the editor IN PLACE (no modal). `readOnly` hides
// the expand affordance for rules that can't be edited (system/legacy).
export function StageRow({
  index, icon, title, question, summary, tone = "", open, onToggle, readOnly = false, last = false, headerAside, children,
}: {
  index: number; icon?: React.ReactNode; title: string; question?: string;
  summary: React.ReactNode; tone?: string; open: boolean; onToggle: () => void;
  readOnly?: boolean; last?: boolean; headerAside?: React.ReactNode; children?: React.ReactNode;
}) {
  const headInner = (
    <>
      <div className="vstage-head-txt">
        <div className="vstage-title">
          {icon && <span className="vstage-ico" aria-hidden="true">{icon}</span>}
          {title}
          {question && <span className="vstage-q"> · {question}</span>}
        </div>
        <div className={`vstage-sum${tone ? ` tone-${tone}` : ""}`}>{summary}</div>
      </div>
      {headerAside}
      {!readOnly && <span className="vstage-chev kv-ico" aria-hidden="true">{open ? I.caret : I.caretRight}</span>}
    </>
  );
  return (
    <div className={`vstage${open ? " open" : ""}${tone ? ` tone-${tone}` : ""}`}>
      <div className="vstage-rail" aria-hidden="true">
        <div className="vstage-num">{index}</div>
        {!last && <div className="vstage-line" />}
      </div>
      <div className="vstage-main">
        {readOnly
          ? <div className="vstage-head static">{headInner}</div>
          : <button type="button" className="vstage-head" aria-expanded={open} onClick={onToggle}>{headInner}</button>}
        {open && !readOnly && <div className="vstage-body">{children}</div>}
      </div>
    </div>
  );
}

// A nested "Advanced" reveal — where the Ory jargon (handler names, regex, JSON,
// config keys) hides so the plain surface stays jargon-free.
export function AdvancedDisclosure({ label = "Advanced", note, defaultOpen = false, children }: {
  label?: string; note?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="advanced">
      <button type="button" className="advanced-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="kv-ico" aria-hidden="true">{open ? I.caret : I.caretRight}</span> {label}
        {note && <span className="advanced-note"> · {note}</span>}
      </button>
      {open && <div className="advanced-body">{children}</div>}
    </div>
  );
}

/**
 * What a person can actually do, from the model the ENGINE decides against — down to the routes.
 *
 * What this replaced walked `state.groups[group]`, the old service → role tables that come from
 * Redis. Those are empty now, so every branch read "no service mappings": the screen was telling an
 * operator that a privileged group grants nothing.
 *
 * The chain shown is the one the engine follows, and every hop is there because every hop is
 * something you could change to take the access away:
 *
 *   group → the organisations it grants in → role → permission → the routes that permission opens
 */
export function PermTree({ user, model, routeTables }: {
  user: { name: string; email: string; groups: string[] };
  model: { groups: Record<string, Record<string, string[]>>; roles: Record<string, string[]> };
  /** Per API, the routes it declares. Absent while they load — the tree still shows the rest. */
  routeTables?: RouteTable[];
}) {
  // Built by the policy module, so what this draws and what the engine follows are one description.
  const branches = React.useMemo(
    () => permissionChain(user.groups, model, routeTables),
    [user.groups, model, routeTables],
  );

  return (
    <div className="permtree">
      <div className="pt-root">
        <Avatar name={user.name} size={26} />
        <div>
          <div className="fw-medium">{user.name}</div>
          <div className="small muted mono">{user.email}</div>
        </div>
      </div>
      {branches.length === 0 && <EmptyHint>No groups &rarr; no access.</EmptyHint>}
      {branches.map((b) => (
        <div key={b.group} className="pt-branch">
          <div className="pt-line v" />
          <div className="pt-group">
            <span className="pt-line h" />
            <span className="mono pt-chip">group &middot; {b.group}</span>
            {!b.declared && <Badge tone="danger" title="Held, but the model declares no such group">not in the model</Badge>}
          </div>
          {b.declared && b.scopes.length === 0 && (
            <div className="pt-svc"><span className="small muted">&mdash; grants nothing &mdash;</span></div>
          )}
          {b.scopes.map((scope) => (
            <div key={scope.organisation} className="pt-svc">
              <span className="pt-line h" />
              {scope.everywhere
                ? <Badge tone="warning" title="Granted in every organisation">in every organisation</Badge>
                : <span className="mono pt-chip">in {scope.organisation}</span>}
              {scope.roles.map((r) => (
                <div key={r.role} className="pt-role">
                  <span className="mono">{r.role}</span>
                  <div className="pt-perms">
                    {!r.known && <Badge tone="danger" title="Named by the group, not defined in the model">undefined role</Badge>}
                    {r.known && r.permissions.length === 0 && <span className="small muted">&mdash; carries nothing &mdash;</span>}
                    {r.permissions.map((p) => (
                      <span key={p.permission} className="pt-perm">
                        <Badge>{p.permission}</Badge>
                        {p.routes.length === 0
                          ? <span className="small muted" title="No declared route requires it — it may be enforced by a service that publishes no table">no route declares it</span>
                          : <span className="small muted" title={p.routes.map((x) => `${x.method} ${x.path}  (${x.api})`).join('\n')}>
                              {p.routes.length} route{p.routes.length === 1 ? '' : 's'} &middot;{' '}
                              <span className="mono">{p.routes.slice(0, 2).map((x) => `${x.method} ${x.path}`).join(', ')}</span>
                              {p.routes.length > 2 && ` +${p.routes.length - 2}`}
                            </span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
