import type { ReactNode } from 'react';

/** One component on the guide: its name, what it is for, and its states side by side. */
export function Specimen({ name, note, children, wide }: { name: string; note?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? 'specimen wide' : 'specimen'} aria-label={name}>
      <header className="specimen-head">
        <h3 className="mono">{name}</h3>
        {note && <p className="small muted">{note}</p>}
      </header>
      <div className="specimen-body">{children}</div>
    </section>
  );
}

/** A labelled state inside a specimen. */
export function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="state">
      <div className="state-label">{label}</div>
      <div className="state-body">{children}</div>
    </div>
  );
}

export function SectionTitle({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div className="design-section-title" id={`ds-${id}`}>
      <h2>{title}</h2>
      <p className="small muted">{sub}</p>
    </div>
  );
}
