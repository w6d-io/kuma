import { useState } from 'react';
import { readBrand, type Brand } from '../lib/brand';

/**
 * The rail's header: the deployment's full logo with "Access console" under it, its small logo
 * when the rail is collapsed (CSS) or in the phone sheet (`compact`), and the console's own "K"
 * tile when there is none — or when the image does not load, so a broken URL never leaves a hole.
 */
export function BrandMark({ compact = false, brand = readBrand() }: { compact?: boolean; brand?: Brand }) {
  const [fullBroken, setFullBroken] = useState(false);
  const [smallBroken, setSmallBroken] = useState(false);
  const full = !compact && brand.full && !fullBroken ? brand.full : null;
  const small = brand.small && !smallBroken ? brand.small : null;
  const tile = small
    ? <img className="logo-small" src={small} alt="" onError={() => setSmallBroken(true)} />
    : <div className="logo-mark" aria-hidden="true">K</div>;

  if (full) {
    return (
      <div className="sidebar-header has-logo">
        <span className="logo-collapsed">{tile}</span>
        <div className="logo-full-wrap">
          <img className="logo-full" src={full} alt="Logo" onError={() => setFullBroken(true)} />
          <span className="s">Access console</span>
        </div>
      </div>
    );
  }
  return (
    <div className="sidebar-header">
      {tile}
      <div className="logo-text">
        {/* The console's name belongs with its own tile; beside a deployment's logo it is noise. */}
        {!small && <span className="n">Kuma</span>}
        <span className="s">Access console</span>
      </div>
    </div>
  );
}
