import React, { useState } from 'react';
import { I } from './Icons';
import { cx } from './cx';
import { LevelMeta } from '../../hooks/useRbac';

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
