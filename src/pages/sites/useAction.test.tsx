import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../components/ui/testing';

// One site action at a time: clicks that land before React disables the button do nothing.

const toast = vi.fn();
vi.mock('../../contexts/AppContext', () => ({ useApp: () => ({ pushToast: toast }) }));

import { useSiteAction } from './useAction';

describe('useSiteAction', () => {
  it('runs once for a burst of clicks, and again once the first has finished', async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => { release = r; }));
    let run!: ReturnType<typeof useSiteAction>['run'];
    function Probe() { run = useSiteAction().run; return null; }
    render(<Probe />);
    await act(async () => { for (let i = 0; i < 5; i++) void run('Request', fn); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await act(async () => { void run('Request', fn); });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
