import type { ReactNode } from 'react';

/**
 * The top of every screen: where you are (breadcrumb or eyebrow), what it is (title, with a status
 * badge beside it when the thing has one), one line on what it is for, and the screen's actions.
 */
export function PageHeader({ title, sub, eyebrow, status, actions }: {
  title: ReactNode;
  sub?: ReactNode;
  /** A breadcrumb or section name above the title. */
  eyebrow?: ReactNode;
  /** A Badge beside the title. */
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <div className="page-title">
          <h1>{title}</h1>
          {status}
        </div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
