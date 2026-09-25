import { useState } from 'react';
import { PageHeader, Segmented } from '../../components/ui';
import { TokensSection } from './TokensSection';
import { ControlsSection } from './ControlsSection';
import { SurfacesSection } from './SurfacesSection';
import { OverlaysSection } from './OverlaysSection';
import { FlowSection } from './FlowSection';

/**
 * `#/design` — the living style guide. Every kit component in every state, drawn by the kit itself,
 * so what is shown here is what the screens get.
 *
 * Not in the navigation: it is for the people building screens. The theme switch repaints only the
 * specimens, so a component can be checked in the other theme without leaving the page's own.
 */
type Preview = 'page' | 'light' | 'dark';

const SECTIONS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'controls', label: 'Controls' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'flow', label: 'Flows & code' },
] as const;

export function DesignPage() {
  const [preview, setPreview] = useState<Preview>('page');
  return (
    <>
      <PageHeader
        eyebrow="Kuma design system"
        title="Style guide"
        sub="Strada palette, semantic tokens, and every component in src/components/ui in each of its states."
        actions={
          <Segmented
            label="Preview theme"
            value={preview}
            onChange={setPreview}
            options={[{ value: 'page', label: 'Page theme' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          />
        }
      />
      <nav className="design-toc" aria-label="Sections">
        {SECTIONS.map((s) => <a key={s.id} href={`#/design`} onClick={(e) => { e.preventDefault(); document.getElementById(`ds-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>{s.label}</a>)}
      </nav>
      <div className="design-canvas" data-theme={preview === 'page' ? undefined : preview}>
        <TokensSection />
        <ControlsSection />
        <SurfacesSection />
        <OverlaysSection />
        <FlowSection />
      </div>
    </>
  );
}
