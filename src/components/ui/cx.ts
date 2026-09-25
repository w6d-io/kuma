/** Class names, skipping the falsy ones: `cx('btn', on && 'on')`. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
