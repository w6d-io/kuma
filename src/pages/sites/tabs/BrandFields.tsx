import { useRef, useState } from 'react';
import { Button, Field, I, Input } from '../../../components/ui';
import { sitesApi, notAvailable } from '../../../api/sites';
import { ACCENT_MIN, logoProblem } from '../../../lib/sites/validate';
import type { SiteEditor } from '../useSiteEditor';
import { useBrand } from './brand';

/**
 * The brand of a site — name, logo and accent — as fields for a FormGrid. One editor, placed on
 * Settings (where an owner looks for it) and on Login (beside the full sign-in preview); both write
 * `login.branding` through useBrand, so the two can never disagree.
 */

export function BrandFields({ ed, readOnly }: { ed: SiteEditor; readOnly: boolean }) {
  const { branding, setBranding, accent } = useBrand(ed);
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const displayName = ed.site?.displayName ?? ed.name;

  async function upload(file: File) {
    const problem = logoProblem(file);
    if (problem) { setLogoError(problem); return; }
    setLogoError(null);
    setUploading(true);
    try {
      const out = await sitesApi.uploadLogo(ed.name, file);
      setBranding({ logo: out.logo });
    } catch (err) {
      setLogoError(notAvailable(err) ? 'Logo upload is not available on this server yet.' : (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    try { await sitesApi.deleteLogo(ed.name); } catch (err) { if (!notAvailable(err)) { setLogoError((err as Error).message); return; } }
    setBranding({ logo: undefined });
  }

  return (
    <>
      <Field label="Name on sign-in pages" hint={`Leave empty to use the display name, ${displayName}.`}>
        <Input value={branding.name ?? ''} placeholder={displayName} maxLength={80} disabled={readOnly} onChange={(e) => setBranding({ name: e.target.value })} />
      </Field>
      <Field label="Logo" hint="PNG or WebP, 256 KB at most, square, at least 128 px. SVG is refused." error={logoError ?? undefined}>
        <div className="row gap-8 items-center">
          <span className="small">{branding.logo ? <span className="mono">{branding.logo}</span> : 'none'}</span>
          {!readOnly && <>
            <input ref={fileRef} type="file" accept="image/png,image/webp" className="sr-only" aria-label="Logo file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            <Button size="sm" icon={I.upload} loading={uploading} onClick={() => fileRef.current?.click()}>{branding.logo ? 'Replace' : 'Upload'}</Button>
            {branding.logo && <Button size="sm" variant="ghost" onClick={() => void remove()}>Remove</Button>}
          </>}
        </div>
      </Field>
      <Field
        label="Accent colour"
        hint={accent && !accent.problem
          ? `Button text ${accent.label.toFixed(1)}:1 · light page ${accent.light.toFixed(1)}:1 · dark page ${accent.dark.toFixed(1)}:1 ✓`
          : `A #rrggbb colour: button text ${ACCENT_MIN.label}:1, ${ACCENT_MIN.light}:1 on the light page, ${ACCENT_MIN.dark}:1 on the dark one. Empty: the platform accent.`}
        error={accent?.problem ?? undefined}
      >
        <Input mono value={branding.accent ?? ''} placeholder="#rrggbb" maxLength={7} disabled={readOnly} onChange={(e) => setBranding({ accent: e.target.value.trim() })} />
      </Field>
    </>
  );
}
