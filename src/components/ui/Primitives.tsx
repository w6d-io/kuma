import React, { useEffect } from 'react';
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

export function Pipeline({ stage }: { stage: string }) {
  const steps = [
    { id: "config", name: "Config", meta: "groups.json" },
    { id: "opal", name: "OPAL", meta: "notify" },
    { id: "opa", name: "OPA", meta: "policy" },
    { id: "oathkeeper", name: "Oathkeeper", meta: "gateway" },
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

export function RulePipeline({ rule }: { rule: { match: { methods: string[] }; authenticators: string[]; authorizer: string; mutators: string[]; upstream?: string } }) {
  const stages = [
    { k: "match", label: "Match", sub: rule.match.methods.join("\u00b7"), icon: I.route },
    { k: "auth", label: "Authenticate", sub: rule.authenticators.join(" \u00b7 ") || "\u2014", icon: I.shield },
    { k: "authz", label: "Authorize", sub: rule.authorizer, icon: rule.authorizer === "allow" ? I.check : I.shield },
    { k: "mutate", label: "Mutate", sub: rule.mutators.join(" \u00b7 ") || "\u2014", icon: I.edit },
    { k: "upstream", label: "Upstream", sub: rule.upstream ? (() => { try { return new URL(rule.upstream).host; } catch { return rule.upstream; } })() : "\u2014", icon: I.box },
  ];
  return (
    <div className="rulepipe">
      {stages.map((st, i) => (
        <React.Fragment key={st.k}>
          <div className={`rp-node rp-${st.k}`}>
            <span className="rp-ico">{st.icon}</span>
            <div className="rp-txt">
              <span className="rp-lbl">{st.label}</span>
              <span className="rp-sub mono">{st.sub}</span>
            </div>
          </div>
          {i < stages.length - 1 && <span className="rp-arrow" aria-hidden="true">{"\u203a"}</span>}
        </React.Fragment>
      ))}
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
