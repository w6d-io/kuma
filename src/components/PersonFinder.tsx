import { useId, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type LookupHit } from '../api/client';
import { isNotAvailable } from '../api/orgAccess';
import { useDebounced } from '../hooks/useDebounced';
import { describeHit, lookupTerm } from '../lib/personFind';
import { Avatar, Badge, I, Input } from './ui';

/**
 * A person, found as you type: the start of an address, a whole one, or a pasted Kratos identity id.
 * The box stays a plain text field — what is typed is the value — and offers who matches underneath;
 * picking one hands the whole person to the screen in one click.
 *
 * Against a server without the lookup it offers nothing and is still an ordinary field.
 */
function useLookup(q: string) {
  const term = lookupTerm(useDebounced(q));
  const query = useQuery({
    queryKey: ['user-lookup', term],
    queryFn: () => api.lookupUsers(term as string),
    enabled: term !== null,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    retry: (n, err) => !isNotAvailable(err) && n < 1,
  });
  return { term, ...query };
}

interface PersonFinderProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (hit: LookupHit) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function PersonFinder({ id, value, onChange, onPick, placeholder, size, className, ...rest }: PersonFinderProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const found = useLookup(value);
  const hits = found.term ? found.data?.data ?? [] : [];
  const showing = open && found.term !== null && (hits.length > 0 || (!found.isFetching && found.isSuccess));

  const pick = (h: LookupHit) => {
    setOpen(false);
    onPick(h);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!showing || hits.length === 0) {
      if (e.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[Math.min(active, hits.length - 1)]); }
  };

  return (
    <div className={className ? `pf ${className}` : 'pf'}>
      {/* Only our own suggestions. autocomplete="off" alone does not stop Safari's contact AutoFill
          (the "Emails" list) on a field it takes for an email — a name holding "search" and no email
          input mode do; the data-* attributes keep 1Password, LastPass, Bitwarden and Dashlane out. */}
      <Input
        id={id}
        name="person-search"
        mono
        size={size}
        leading={I.search}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && hits.length ? `${listId}-${Math.min(active, hits.length - 1)}` : undefined}
        placeholder={placeholder ?? 'Email, start of an email, or Kratos id'}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        // Deferred, so a click on an option lands before the list goes.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        aria-label={rest['aria-label']}
      />
      {showing && (
        <ul className="pf-list" id={listId} role="listbox" aria-label="Matching people">
          {hits.length === 0 && <li className="pf-none small muted" role="presentation">Nobody matches “{found.term}”.</li>}
          {hits.map((h, i) => (
            <li
              key={h.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-label={describeHit(h)}
              className="pf-opt"
              onMouseDown={(e) => { e.preventDefault(); pick(h); }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar name={h.name ?? undefined} email={h.email} />
              <span className="pf-who">
                <span className="fw-medium">{h.name ?? h.email}</span>
                {h.name && <span className="small muted mono">{h.email}</span>}
              </span>
              <PersonBadges hit={h} />
            </li>
          ))}
          {found.data?.match === 'contains' && hits.length > 0 && (
            <li className="pf-none small muted" role="presentation">No address starts with that; showing names and addresses that contain it.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Groups, organisations and 2FA as short badges; an unreadable part says so rather than "none". */
export function PersonBadges({ hit }: { hit: LookupHit }) {
  return (
    <span className="row wrap gap-4 pf-badges">
      {!hit.active && <Badge tone="warning">inactive</Badge>}
      {hit.groups === null
        ? <Badge tone="plain" title="The access engine did not answer">groups unknown</Badge>
        : hit.groups.slice(0, 3).map((g) => <Badge key={g}>{g}</Badge>)}
      {hit.groups && hit.groups.length > 3 && <Badge tone="plain" title={hit.groups.slice(3).join('\n')}>+{hit.groups.length - 3} more</Badge>}
      {hit.mfa === true && <Badge tone="success" title="Has a second factor"><span className="chip-ico">{I.lock}</span>2FA</Badge>}
      {hit.mfa === false && <Badge tone="warning" title="No second factor"><span className="chip-ico">{I.alert}</span>no 2FA</Badge>}
    </span>
  );
}
