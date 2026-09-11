import React, { useEffect, useState } from 'react';
import { I } from './Icons';
import { accessLevelOf, LevelMeta } from '../../hooks/useRbac';

export function Chip({ tone = "", children, mono = true, title }: { tone?: string; children: React.ReactNode; mono?: boolean; title?: string }) {
  return <span className={`chip ${tone}`} style={mono ? undefined : { fontFamily: "var(--font-sans)" }} title={title}>{children}</span>;
}

export function Method({ m }: { m: string }) {
  return <span className={`method ${m}`}>{m}</span>;
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label="Toggle" />;
}

export function Avatar({ name, email, size = 22 }: { name?: string; email?: string; size?: number }) {
  const src = name || email || "?";
  const initials = src.split(/\s+|@/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join("");
  const h = [...src].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = h % 360;
  const bg = `oklch(62% 0.13 ${hue})`;
  const bg2 = `oklch(52% 0.13 ${(hue + 30) % 360})`;
  return <span className="avatar" style={{ width: size, height: size, background: `linear-gradient(135deg, ${bg}, ${bg2})`, fontSize: Math.max(9, size * 0.42) }}>{initials}</span>;
}

export function Drawer({ open, onClose, title, eyebrow, children, footer, size = "" }: {
  open: boolean; onClose: () => void; title: string; eyebrow?: string;
  children: React.ReactNode; footer?: React.ReactNode; size?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className={`drawer ${size}`} onClick={e => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.close}</span>
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, eyebrow, children, footer, size = "" }: {
  open: boolean; onClose: () => void; title: string; eyebrow?: string;
  children: React.ReactNode; footer?: React.ReactNode; size?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className={`modal ${size}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            <span style={{ width: 14, height: 14, display: "grid", placeItems: "center" }}>{I.close}</span>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Standard confirmation for destructive actions. Optional blast-radius line
// ("affects N users") and optional type-to-confirm for high-impact actions.
// One dialog for every delete/deactivate across the app (UX consistency).
export function ConfirmDialog({
  open, title, body, blastRadius, confirmLabel = "Confirm", danger = false,
  requireText, onConfirm, onCancel, busy = false,
}: {
  open: boolean; title: string; body?: React.ReactNode; blastRadius?: React.ReactNode;
  confirmLabel?: string; danger?: boolean; requireText?: string;
  onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) setTyped(""); }, [open]);
  const ready = !requireText || typed.trim() === requireText;
  const dangerStyle = danger ? { background: "var(--red, #ef4444)", borderColor: "var(--red, #ef4444)", color: "#fff" } : undefined;
  return (
    <Modal open={open} onClose={onCancel} title={title}
      footer={<>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn primary" style={dangerStyle} onClick={onConfirm} disabled={!ready || busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </>}>
      {body && <div className="small" style={{ lineHeight: 1.6, color: "var(--ink-2)" }}>{body}</div>}
      {blastRadius && (
        <div className="panel" style={{ padding: "10px 12px", marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 14, height: 14, display: "grid", placeItems: "center", color: "var(--warn)", flexShrink: 0 }}>{I.alert}</span>
          <span className="small">{blastRadius}</span>
        </div>
      )}
      {requireText && (
        <div style={{ marginTop: 12 }}>
          <label className="input-label">Type <span className="mono">{requireText}</span> to confirm</label>
          <input className="input mono" autoFocus value={typed} onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && ready && !busy) onConfirm(); }} style={{ width: "100%" }} />
        </div>
      )}
    </Modal>
  );
}

export function Pipeline({ stage }: { stage: string }) {
  // The real path a change takes. Named for what each step is, so the echo cannot promise a
  // propagation the deployment does not perform.
  const steps = [
    { id: "stored", name: "Stored", meta: "jinbe" },
    { id: "bundle", name: "Bundle", meta: "new revision" },
    { id: "engine", name: "Engine", meta: "polls, ≤40s" },
  ];
  const idx = steps.findIndex(s => s.id === stage);
  return (
    <div className="pipe">
      {steps.map((s, i) => {
        const cls = stage === "idle" ? "" : i < idx ? "done" : i === idx ? "current" : "";
        return (
          <div key={s.id} className={`step ${cls}`}>
            <div className="name">{s.name}</div>
            <div className="meta">{s.meta}</div>
          </div>
        );
      })}
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 12 }}>{children}</div>;
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
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map(o => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            className="chip mono"
            aria-pressed={on}
            onClick={() => onToggle(o)}
            style={{ cursor: "pointer", fontWeight: 500, background: on ? "var(--accent)" : "var(--panel-2)", color: on ? "white" : "var(--ink-2)", borderColor: on ? "var(--accent)" : "var(--line)" }}
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

export function Toasts({ toasts }: { toasts: { id: string; msg: string; err?: boolean; sub?: string }[] }) {
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.err ? "err" : ""}`}>
          <span className="d" />
          <div>
            <div>{t.msg}</div>
            {t.sub && <div className="lbl">{t.sub}</div>}
          </div>
        </div>
      ))}
    </div>
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
        {note && <span className="muted small" style={{ fontWeight: 400 }}> · {note}</span>}
      </button>
      {open && <div className="advanced-body">{children}</div>}
    </div>
  );
}

export function PermTree({ user, state }: { user: { name: string; email: string; groups: string[] }; state: { groups: Record<string, Record<string, string[]>>; roles: Record<string, Record<string, string[]>> } }) {
  const branches = user.groups.map(g => {
    const map = state.groups[g] || {};
    const svcs = Object.entries(map).map(([svc, roles]) => ({
      svc,
      roles: roles.map(rName => ({
        name: rName,
        perms: (state.roles[svc]?.[rName]) || [],
      })),
    }));
    return { group: g, svcs };
  });

  return (
    <div className="permtree">
      <div className="pt-root">
        <Avatar name={user.name} size={26} />
        <div>
          <div style={{ fontWeight: 500 }}>{user.name}</div>
          <div className="small muted mono">{user.email}</div>
        </div>
      </div>
      {branches.length === 0 && <EmptyHint>No groups &rarr; no access.</EmptyHint>}
      {branches.map(b => (
        <div key={b.group} className="pt-branch">
          <div className="pt-line v" />
          <div className="pt-group">
            <span className="pt-line h" />
            <span className="mono pt-chip">group &middot; {b.group}</span>
          </div>
          <div className="pt-services">
            {b.svcs.length === 0 && <div className="small muted" style={{ paddingLeft: 32 }}>&mdash; no service mappings &mdash;</div>}
            {b.svcs.map(sv => (
              <div key={sv.svc} className="pt-svc">
                <span className="pt-line h" />
                <div className="pt-svc-head">
                  <span className="mono">{sv.svc}</span>
                  <AccessLevel level={accessLevelOf(sv.roles.flatMap(r => r.perms))} compact />
                </div>
                <div>
                  {sv.roles.map(r => (
                    <div key={r.name} className="pt-role">
                      <span className="mono small">{r.name}</span>
                      <div className="pt-perms">
                        {r.perms.includes("*")
                          ? <Chip tone="accent">wildcard &middot; *</Chip>
                          : r.perms.length === 0
                            ? <span className="small muted">&mdash;</span>
                            : r.perms.slice(0, 8).map(p => <Chip key={p}>{p}</Chip>)}
                        {r.perms.length > 8 && <span className="small muted">+{r.perms.length - 8} more</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
