import { SectionTitle, Specimen } from './Specimen';

// The names in tokens.css, grouped as they are there. Each swatch is painted by its own token, so a
// value changed in the stylesheet changes here without touching this file.
const COLORS: { group: string; tokens: string[] }[] = [
  { group: 'Surfaces', tokens: ['bg', 'surface', 'surface-2', 'surface-3', 'sidebar', 'hover'] },
  { group: 'Text', tokens: ['text', 'text-muted', 'text-subtle', 'text-disabled'] },
  { group: 'Lines', tokens: ['border', 'border-strong', 'focus-ring'] },
  { group: 'Actions', tokens: ['primary', 'primary-hover', 'accent', 'accent-hover', 'accent-soft'] },
  { group: 'Status', tokens: ['success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft', 'info', 'info-soft'] },
];

const SPACES = ['half', '1', '2', '3', '4', '5', '6', '7'];
const SPACE_PX: Record<string, number> = { half: 2, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 };
const TEXT = [
  { t: 'xl', px: 20, use: 'page titles, figures' },
  { t: 'lg', px: 16, use: 'dialog titles' },
  { t: 'md', px: 14, use: 'drawer titles, empty-state titles' },
  { t: 'base', px: 13, use: 'body, tables, controls' },
  { t: 'sm', px: 12, use: 'secondary lines, small buttons' },
  { t: 'xs', px: 11, use: 'labels, badges, meta' },
];

export function TokensSection() {
  return (
    <>
      <SectionTitle id="tokens" title="Tokens" sub="src/styles/tokens.css, mapped onto vendor/strada-tokens.css. AA contrast in both themes is a test (contrast.test.ts)." />
      <Specimen name="--color-*" note="Semantic colours. Components read only these." wide>
        <div className="swatch-groups">
          {COLORS.map((g) => (
            <div key={g.group} className="swatch-group">
              <div className="eyebrow mb-8">{g.group}</div>
              <div className="swatches">
                {g.tokens.map((t) => (
                  <div key={t} className="swatch-cell">
                    <span className="swatch" data-token={t} />
                    <span className="mono text-xs">--color-{t}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Specimen>
      <div className="specimen-grid">
        <Specimen name="--radius-*" note="Three corners, all Strada's. Round is for circles only (avatars, switches, radios); never a label.">
          <div className="row gap-16 wrap">
            {['sm', 'md', 'round'].map((r) => (
              <div key={r} className="col items-start gap-4">
                <span className="radius-demo" data-radius={r} />
                <span className="mono text-xs">--radius-{r}</span>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen name="--control-*" note="Button and input heights.">
          <div className="row gap-16 items-end">
            <div className="col items-start gap-4"><span className="control-demo sm" /><span className="mono text-xs">--control-sm 28px</span></div>
            <div className="col items-start gap-4"><span className="control-demo md" /><span className="mono text-xs">--control-md 36px</span></div>
          </div>
        </Specimen>
        <Specimen name="--space-*" note="Strada's 4px scale.">
          <div className="col gap-4">
            {SPACES.map((s) => (
              <div key={s} className="row gap-8">
                <span className="mono text-xs space-name">--space-{s}</span>
                <span className="space-bar" data-space={s} />
                <span className="text-xs muted">{SPACE_PX[s]}px</span>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen name="--shadow-*" note="Elevation; restated for the dark theme.">
          <div className="row gap-16 wrap">
            {['sm', 'md', 'lg'].map((s) => <span key={s} className="shadow-demo" data-shadow={s}>{s}</span>)}
          </div>
        </Specimen>
      </div>
      <Specimen name="--text-*" note="Six sizes, each with its line height." wide>
        <div className="col gap-8">
          {TEXT.map((x) => (
            <div key={x.t} className="type-row">
              <span className="mono text-xs muted">--text-{x.t} · {x.px}px</span>
              <span className={`text-${x.t}`}>Grant access to Acme's billing site</span>
              <span className="text-xs muted">{x.use}</span>
            </div>
          ))}
        </div>
      </Specimen>
    </>
  );
}
