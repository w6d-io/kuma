import { useEffect, useRef, useState } from 'react';
import { Button, I } from './ui';

/**
 * A document, shown the way somebody would read it in the repository.
 *
 * Read-only on purpose, and the editor is here for reading rather than in spite of it: line numbers
 * to talk about a line, folding to skip a block, find-in-document, and a selection that copies
 * whitespace faithfully. A `<pre>` gives none of those, and re-implementing them is exactly the
 * wheel not to rebuild.
 *
 * Loaded on demand. It is the heaviest thing in this console and only one screen shows it, so
 * paying for it on first paint would slow down every screen that does not.
 */
export function YamlView({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ destroy: () => void; dispatch: (t: unknown) => void; state: { doc: { length: number } } } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ EditorState }, { EditorView, lineNumbers, highlightActiveLine }, { foldGutter, syntaxHighlighting, HighlightStyle }, { yaml }, { tags }, { search, highlightSelectionMatches }] = await Promise.all([
          import('@codemirror/state'),
          import('@codemirror/view'),
          import('@codemirror/language'),
          import('@codemirror/lang-yaml'),
          import('@lezer/highlight'),
          import('@codemirror/search'),
        ]);
        if (cancelled || !host.current) return;

        // Colours come from the design-system tokens, so both themes are one definition rather than
        // two palettes to keep in step.
        const highlight = HighlightStyle.define([
          { tag: tags.keyword, color: 'var(--color-accent)' },
          { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--color-accent)' },
          { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-text)' },
          { tag: [tags.number, tags.bool, tags.null], color: 'var(--color-success)' },
          { tag: tags.comment, color: 'var(--color-text-subtle)', fontStyle: 'italic' },
          { tag: tags.meta, color: 'var(--color-text-subtle)' },
        ]);

        const theme = EditorView.theme({
          '&': { backgroundColor: 'transparent', color: 'var(--color-text)', fontSize: '12.5px' },
          '.cm-scroller': { fontFamily: 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)', lineHeight: '1.65' },
          '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--color-text-subtle)', border: 'none' },
          '.cm-activeLine': { backgroundColor: 'var(--color-hover)' },
          '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-text)' },
          '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--sel, rgba(125,125,125,.25))' },
          '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-subtle)' },
          '.cm-panels': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' },
          '.cm-searchMatch': { backgroundColor: 'var(--sel, rgba(125,125,125,.25))' },
          '&.cm-focused': { outline: 'none' },
        });

        const state = EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            foldGutter(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            search({ top: true }),
            yaml(),
            syntaxHighlighting(highlight),
            theme,
            // Both, and deliberately: `readOnly` refuses the transactions, `editable` also removes
            // the caret and the contenteditable, so nothing about it invites a change that cannot
            // be made.
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-readonly': 'true' }),
          ],
        });

        view.current = new EditorView({ state, parent: host.current }) as unknown as typeof view.current;
      } catch {
        // The document still has to be readable if the editor cannot load.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
    };
    // Rebuilt when the document changes: a read-only view has no state worth preserving across one.
  }, [value, ariaLabel]);

  if (failed) {
    return (
      <pre className="yaml-fallback mono" aria-label={ariaLabel}>
        {value}
      </pre>
    );
  }

  return <div className="yaml-view" ref={host} aria-label={ariaLabel} />;
}

/** Copy the document as it stands. Small, and the one thing a reader always wants next. */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={done ? I.check : I.copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}
