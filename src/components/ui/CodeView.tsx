import { useEffect, useRef, useState } from 'react';
import { cx } from './cx';
import { I } from './Icons';
import { Button } from './Button';

/**
 * Code to read and copy: a rule, a snippet, a generated file. Monospace, scrolls inside itself, and
 * a copy button that says whether the copy worked — a clipboard can refuse (no permission, an
 * insecure origin), and a button that stays silent then is a button that lies.
 *
 * For code to EDIT, the CodeMirror view (YamlView) is the tool.
 */
export function CodeView({ code, title, language, maxHeight, wrap, className }: {
  code: string;
  title?: string;
  /** Shown in the header beside the title — "yaml", "json", "shell". */
  language?: string;
  /** Cap in CSS units; the block scrolls beyond it. */
  maxHeight?: 'sm' | 'md' | 'lg';
  /** Wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  return (
    <div className={cx('codeview', className)}>
      <div className="codeview-head">
        <span className="codeview-title">{title}{language && <span className="codeview-lang">{language}</span>}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={state === 'copied' ? I.check : state === 'failed' ? I.alert : I.copy}
          aria-label={`Copy${title ? ` ${title}` : ''}`}
          onClick={() => void copy()}
        >
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
        </Button>
      </div>
      <pre className={cx('codeview-body', maxHeight && `max-${maxHeight}`, wrap && 'wrap')}><code>{code}</code></pre>
    </div>
  );
}
