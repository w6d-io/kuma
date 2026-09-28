import { useEffect, useRef, useState } from 'react';
import { cx } from './cx';
import { I } from './Icons';
import { Button } from './Button';
import { Input } from './Input';

/**
 * A value to copy exactly — a secret, a client id, a server address: read-only, monospace, and a
 * Copy button beside it that says "Copied" for a moment. Where the clipboard is refused (an
 * insecure origin, a denied permission) the text is selected instead and the line under it says to
 * copy it by hand — never a silent failure somebody discovers later.
 *
 * Inside a `Field` the input takes the field's label; alone, give it `label`.
 */
export function CopyField({ value, label, onCopied, size = 'md', className }: {
  value: string;
  /** The accessible name when there is no Field around it. */
  label?: string;
  onCopied?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state !== 'copied') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(value);
      setState('copied');
      onCopied?.();
    } catch {
      input.current?.focus();
      input.current?.select();
      setState('failed');
    }
  };

  return (
    <div className={cx('copy-field', className)}>
      <div className="copy-field-row">
        <Input
          ref={input}
          mono
          readOnly
          size={size}
          value={value}
          aria-label={label}
          spellCheck={false}
          autoComplete="off"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button size={size} icon={state === 'copied' ? I.check : I.copy} onClick={() => void copy()} aria-label={label ? `Copy ${label.toLowerCase()}` : undefined}>
          {state === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="copy-field-note" aria-live="polite">
        {state === 'failed' ? 'Could not reach the clipboard. The text is selected: copy it with ⌘C or Ctrl+C.' : ''}
      </div>
    </div>
  );
}
