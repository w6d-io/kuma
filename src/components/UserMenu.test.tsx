import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from './ui/testing';
import { UserMenu } from './UserMenu';

afterEach(cleanup);

const menu = (twoStepHref?: string) => render(
  <QueryClientProvider client={new QueryClient()}>
    <UserMenu email="root@example.com" role="super_admin" onOpenSettings={() => {}} onOpenTweaks={() => {}} twoStepHref={twoStepHref} />
  </QueryClientProvider>,
);

describe('UserMenu · two-step mark', () => {
  it('marks the account when two-step sign-in is required and missing', () => {
    const { container } = menu('https://auth.example.net/two-step?return_to=x');
    expect(container.querySelector('.userbtn-alert')).not.toBeNull();
    expect(container.querySelector('.userbtn')!.getAttribute('aria-label')).toBe('Account — two-step sign-in required');
  });
  it('no mark otherwise', () => {
    const { container } = menu();
    expect(container.querySelector('.userbtn-alert')).toBeNull();
  });
});
