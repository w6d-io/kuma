import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Just enough of a renderer for the kit's tests: mount into jsdom, act, query the DOM.
 *
 * No testing library — what these tests check is markup and ARIA, which the DOM answers directly,
 * and one more dependency for that is not worth its upgrades.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  rerender: (ui: ReactNode) => void;
  unmount: () => void;
}

const mounted: { root: Root; container: HTMLElement }[] = [];

export function render(ui: ReactNode): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  mounted.push({ root, container });
  return {
    container,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

export function cleanup(): void {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  document.body.innerHTML = '';
}

export function click(el: Element | null): void {
  if (!el) throw new Error('nothing to click');
  act(() => { (el as HTMLElement).click(); });
}

export function key(el: Element | null, keyName: string): void {
  if (!el) throw new Error('nothing to press on');
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true })); });
}

export function type(el: Element | null, value: string): void {
  if (!el) throw new Error('nothing to type in');
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
