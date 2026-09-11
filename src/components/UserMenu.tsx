import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from './ui/Primitives';
import { I } from './ui/Icons';
import { leave } from '../auth/leave';

/**
 * Who is signed in, and the few things somebody does about it.
 *
 * At the foot of the rail, where this platform's own consoles put it. One row that opens a menu,
 * rather than a row that navigates AND carries a link inside it: those were two targets on top of
 * each other, and the small one won by accident.
 *
 * Built on a menu primitive rather than by hand. Outside-click, Escape, focus return, roving focus
 * with the arrow keys, `aria-expanded` and collision-aware placement are all things a menu needs and
 * none of them are this console's problem to solve. The primitive also renders in a PORTAL, which is
 * what makes it safe here: the rail slides in on a transform on a narrow screen, and a menu
 * positioned inside a transformed ancestor is placed against that ancestor rather than the screen.
 */
export function UserMenu({
  email,
  role,
  onOpenSettings,
  onOpenTweaks,
}: {
  email: string;
  role: string;
  onOpenSettings: () => void;
  onOpenTweaks: () => void;
}) {
  const queryClient = useQueryClient();
  const [local, domain] = email.split('@');

  return (
    <Menu.Root>
      <Menu.Trigger className="userbtn" aria-label="Account">
        <Avatar name={local} />
        <span className="userbtn-text">
          <span className="userbtn-name">
            <span className="user-local">{local}</span>
            {domain && <span className="user-domain">@{domain}</span>}
          </span>
          <span className="userbtn-role">{role}</span>
        </span>
        <span className="chev" aria-hidden="true"><span style={{ width: 11, height: 11, display: 'inline-grid', placeItems: 'center' }}>{I.caretUp}</span></span>
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content className="usermenu-content" side="top" align="start" sideOffset={6} collisionPadding={10}>
          <Menu.Label className="usermenu-label">
            {email}
          </Menu.Label>

          <Menu.Separator className="usermenu-sep" />

          {/* No organisations here on purpose: this console administers every one the token carries
              at once, so a list would inform nobody and a choice would change nothing. The switcher
              on the Org Admin screen is where an organisation is picked, because that is the screen
              it changes. */}
          <Menu.Item className="usermenu-item" onSelect={onOpenSettings}>
            Account settings
          </Menu.Item>

          <Menu.Item className="usermenu-item" onSelect={onOpenTweaks}>
            Tweaks
          </Menu.Item>

          <Menu.Separator className="usermenu-sep" />

          <Menu.Item
            className="usermenu-item danger"
            onSelect={() => void leave(() => queryClient.clear())}
          >
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
