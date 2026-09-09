import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from './ui/Primitives';
import { leave } from '../auth/leave';

/**
 * Who is signed in, and the few things somebody does about it.
 *
 * A bubble in the corner rather than a row in the rail. The rail answers "where am I going"; this
 * answers "who am I", which is a different question and does not belong where it can be mistaken
 * for navigation. The corner also survives every page, including the ones with no rail.
 *
 * Built on a menu primitive rather than by hand. Outside-click, Escape, focus return, roving focus
 * with the arrow keys, `aria-expanded`, and collision-aware placement are all things a menu needs
 * and none of them are this console's problem to solve. The primitive also renders in a PORTAL,
 * which is what keeps the placement honest: positioned inside the rail, an ancestor with a
 * transform — which the rail has the moment it slides in on a narrow screen — would become the
 * containing block and the bubble would land in the middle of the rail instead of the corner.
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
      <Menu.Trigger className="userbubble" aria-label="Account">
        <Avatar name={local} />
        {/* Hidden on a narrow screen by CSS, where the avatar alone is the whole control: a name
            and a role beside it would take a third of the width from the page itself. */}
        <span className="userbubble-text">
          <span className="userbubble-name">
            <span className="user-local">{local}</span>
            {domain && <span className="user-domain">@{domain}</span>}
          </span>
          <span className="userbubble-role">{role}</span>
        </span>
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content className="usermenu-content" side="top" align="end" sideOffset={8} collisionPadding={12}>
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
