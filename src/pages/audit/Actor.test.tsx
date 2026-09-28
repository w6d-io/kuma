import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '../../components/ui/testing';
import { forgetActors, rememberActors } from '../../lib/audit/actorNames';
import { ActorCell } from './Actor';

// The trail keeps ids; jinbe names them beside the page for whoever may look people up.

const A = 'c1a5623e-5c44-4a4b-9f0e-000000000001';
const B = 'c1a5623e-5c44-4a4b-9f0e-000000000002';
const mount = (id: string) =>
  render(<QueryClientProvider client={new QueryClient()}><ActorCell actor={{ type: 'user', id } as never} /></QueryClientProvider>);

afterEach(() => { cleanup(); forgetActors(); });

describe('audit actor', () => {
  it('shows the short id until a page names it, then the name and email, with the full id on hover', () => {
    const { container } = mount(A);
    expect(container.textContent).toContain('user · c1a5623e');
    act(() => rememberActors({ [A]: { email: 'maxime@example.com', name: 'Maxime' } }));
    expect(container.textContent).toContain('Maxime');
    expect(container.textContent).toContain('maxime@example.com');
    expect(container.querySelector('.audit-actor')?.getAttribute('title')).toBe(A);
  });

  it('says a deleted account is deleted, keeping its short id', () => {
    rememberActors({ [B]: null });
    const { container } = mount(B);
    expect(container.textContent).toContain('deleted user · c1a5623e');
  });
});
