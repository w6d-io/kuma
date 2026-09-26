import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { cleanup, render } from './testing';
import { Field } from './Field';
import { ActionBar, FieldRow, FormGrid, Toolbar, ToolbarSpacer } from './Form';
import { Input } from './Input';
import { Button } from './Button';

afterEach(cleanup);

describe('FieldRow', () => {
  it('gives each field its share and anything else its own width', () => {
    const { container } = render(
      <FieldRow>
        <Field label="Service" span={2}><Input /></Field>
        <Field label="Namespace" span={2}><Input /></Field>
        <Field label="Port"><Input /></Field>
        <Button>Check</Button>
      </FieldRow>,
    );
    const row = container.querySelector<HTMLElement>('.form-row')!;
    expect(row.style.getPropertyValue('--form-cols')).toBe('minmax(0, 2fr) minmax(0, 2fr) minmax(0, 1fr) max-content');
  });

  it('keeps every field on the same three lines: label, control, messages', () => {
    const { container } = render(
      <FieldRow>
        <Field label="A" hint="said about A" error="wrong"><Input /></Field>
        <Field label="B"><Input /></Field>
      </FieldRow>,
    );
    const [a, b] = [...container.querySelectorAll('.form-row > .field')];
    expect([...a.children].map((c) => c.className)).toEqual(['field-label', 'field-control', 'field-foot']);
    // Nothing said: no empty third line to push anything around.
    expect([...b.children].map((c) => c.className)).toEqual(['field-label', 'field-control']);
    expect(a.querySelector('input')!.getAttribute('aria-describedby')).toContain(a.querySelector('.field-hint')!.id);
  });
});

describe('FormGrid · Toolbar · ActionBar', () => {
  it('draw their layout classes', () => {
    const { container } = render(
      <>
        <FormGrid labels="aside"><Field label="Name"><Input /></Field></FormGrid>
        <Toolbar inset label="Filter"><Input size="sm" aria-label="q" /><ToolbarSpacer /></Toolbar>
        <ActionBar align="start" start={<Button>Delete</Button>}><Button>Save</Button></ActionBar>
      </>,
    );
    expect(container.querySelector('.form-grid.aside')).not.toBeNull();
    expect(container.querySelector('[role="toolbar"].toolbar.sm.inset')?.getAttribute('aria-label')).toBe('Filter');
    expect(container.querySelector('.action-bar.start > .action-bar-start')?.textContent).toBe('Delete');
  });
});

// ── Guard: fields side by side go through FieldRow ─────────────────────────────────────────────
// A hand-made flex or grid row of Fields is how the service / namespace / port misalignment was
// born: each screen spaced and aligned its own. The screens are parsed (not grepped), and a plain
// element holding two or more Fields directly with a row/grid-ish class fails the build.
const SRC = join(__dirname, '..', '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'ui' ? [] : tsxFiles(p);
    return p.endsWith('.tsx') && !p.endsWith('.test.tsx') ? [p] : [];
  });
}

function tagName(el: ts.JsxElement): string {
  return el.openingElement.tagName.getText();
}

function classOf(el: ts.JsxElement): string {
  for (const a of el.openingElement.attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText() === 'className' && a.initializer && ts.isStringLiteral(a.initializer)) return a.initializer.text;
  }
  return '';
}

describe('layout guard', () => {
  it('no hand-made row or grid of Fields outside FieldRow', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      // Only the kit's Field: a screen may have a local component of that name (a definition list).
      if (!/import \{[^}]*\bField\b[^}]*\} from '[./]*components\/ui'/.test(text)) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) && /^[a-z]/.test(tagName(node)) && /\b(row|grid|wrap|site-host-row|site-form-grid)\b/.test(classOf(node))) {
          const fields = node.children.filter((c) => ts.isJsxElement(c) && tagName(c) === 'Field');
          if (fields.length >= 2) offenders.push(`${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });

  it('no stylesheet spaces a field from its sibling', () => {
    const css = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? css(p) : p.endsWith('.css') ? [p] : [];
    });
    const bad = css(SRC).filter((p) => /\.field\s*\+\s*\.field/.test(readFileSync(p, 'utf8'))).map((p) => relative(SRC, p));
    expect(bad).toEqual([]);
  });
});
