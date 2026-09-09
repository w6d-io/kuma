import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from './ui/Primitives';
import { leave } from '../auth/leave';
import { useMyOrganizations, useMyOrganizationNames } from '../api/hooks';

/**
 * Who is signed in, and the few things somebody does about it.
 *
 * A menu rather than a row that navigates: the row carried a whole destination AND a sign-out link
 * inside it, so the two targets sat on top of each other and the small one won by accident. Opening
 * a menu makes each choice its own click.
 *
 * It lives at the foot of the rail, and it opens UPWARDS for that reason — a menu that grows
 * downwards from the bottom of the screen has nowhere to go.
 */
export function UserMenu({
  email,
  role,
  onOpenSettings,
}: {
  email: string;
  role: string;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const orgs = useMyOrganizations().data ?? [];
  const names = useMyOrganizationNames().data ?? {};

  const [local, domain] = email.split('@');

  // A menu that only closes on its own trigger is a menu people leave open and then click through.
  useEffect(() => {
    if (!open) return;

    function away(event: MouseEvent) {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="usermenu" ref={holder}>
      {open && (
        <div className="menu" role="menu">
          {orgs.length > 0 && (
            <>
              <p className="menu-label">
                {orgs.length === 1 ? 'Organization' : `${orgs.length} organizations`}
              </p>
              {/* Listed, not switchable: this console administers every organization the token
                  carries at once, and the switcher on the Org Admin screen is what moves between
                  them. A radio here would promise a choice that changes nothing. */}
              {orgs.map((org) => (
                <p className="menu-org" key={org} title={org}>
                  {names[org] ?? org}
                </p>
              ))}
              <div className="menu-sep" />
            </>
          )}

          <button type="button" className="menu-item" onClick={onOpenSettings} role="menuitem">
            Account settings
          </button>

          <div className="menu-sep" />

          <button
            type="button"
            className="menu-item danger"
            role="menuitem"
            onClick={() => void leave(() => queryClient.clear())}
          >
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        className={`userbtn ${open ? 'on' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((was) => !was)}
      >
        <Avatar name={local} />
        <span className="userbtn-text">
          <span className="userbtn-name">
            <span className="user-local">{local}</span>
            {domain && <span className="user-domain">@{domain}</span>}
          </span>
          <span className="userbtn-role">{role}</span>
        </span>
        <span className="chev" aria-hidden="true">
          {open ? '▾' : '▴'}
        </span>
      </button>
    </div>
  );
}
