import { useMemo } from 'react';
import { useOrgCatalog } from '../api/orgCatalog';
import { orgOptions } from '../lib/orgOptions';

/**
 * Pick an organisation by name. Replaces the free-text UUID fields: nobody should have to paste an
 * identifier to say "Acme". `exclude` hides ids already chosen elsewhere; the current `value` is
 * always listed, known or not, so the picker never drops what it was handed.
 */
export function OrgPicker({
  value,
  onChange,
  exclude = [],
  noneLabel,
  placeholder = 'Choose an organization…',
  disabled,
  style,
  ariaLabel = 'Organization',
}: {
  value: string;
  onChange: (id: string) => void;
  exclude?: string[];
  /** Offer an explicit "no organization" choice with this label. */
  noneLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const { orgs, isLoading, error } = useOrgCatalog();
  const options = useMemo(
    () => orgOptions(orgs, [value]).filter((o) => o.id === value || !exclude.includes(o.id)),
    [orgs, value, exclude],
  );
  return (
    <select
      className="input"
      aria-label={ariaLabel}
      style={style}
      value={value}
      disabled={disabled || isLoading}
      onChange={(e) => onChange(e.target.value)}
      title={error ? `Organizations could not be listed — ${error.message}` : undefined}
    >
      {noneLabel !== undefined
        ? <option value="">{noneLabel}</option>
        : <option value="" disabled>{isLoading ? 'Loading organizations…' : error ? 'Organizations unavailable' : placeholder}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.known ? o.label : `${o.label} (unknown organization)`}
        </option>
      ))}
    </select>
  );
}
