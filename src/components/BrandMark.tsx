import { useState } from 'react';
import { readBrand, type Brand } from '../lib/brand';
import { cx } from './ui';

/**
 * The deployment's brand wherever the console names itself: the rail's header, the collapsed rail,
 * the phone bar, and the organisation screens shown before the console. Every image has its box
 * before it loads (no jump), the "K" tile appears only when there is no logo or it fails to load (no
 * flash of it while a good one loads), and a logo with no dark variant sits on a neutral plate that
 * reads in both themes.
 */

/** The square mark: the small logo, or the console's tile. */
export function BrandIcon({ brand = readBrand(), className }: { brand?: Brand; className?: string }) {
  const [broken, setBroken] = useState(false);
  return brand.small && !broken
    ? <img className={cx('logo-small', className)} src={brand.small} alt="" width={26} height={26} onError={() => setBroken(true)} />
    : <div className={cx('logo-mark', className)} aria-hidden="true">K</div>;
}

/** The full logo, with its dark-theme variant when there is one. `onBroken`: either failed to load. */
function FullLogo({ brand, onBroken }: { brand: Brand; onBroken: () => void }) {
  const alt = brand.appName ?? 'Logo';
  return (
    <span className="logo-full-box">
      {brand.fullDark ? (
        <>
          <img className="logo-full only-light" src={brand.full!} alt={alt} height={28} onError={onBroken} />
          <img className="logo-full only-dark" src={brand.fullDark} alt={alt} height={28} onError={onBroken} />
        </>
      ) : (
        <img className="logo-full plated" src={brand.full!} alt={alt} height={28} onError={onBroken} />
      )}
    </span>
  );
}

/** The rail's header. `compact`: the phone sheet, which shows the square mark. */
export function BrandMark({ compact = false, brand = readBrand() }: { compact?: boolean; brand?: Brand }) {
  const [fullBroken, setFullBroken] = useState(false);
  if (brand.full && !fullBroken && !compact) {
    return (
      <div className="sidebar-header has-logo">
        <span className="logo-collapsed"><BrandIcon brand={brand} /></span>
        <div className="logo-full-wrap">
          <FullLogo brand={brand} onBroken={() => setFullBroken(true)} />
          <span className="s">Access console</span>
        </div>
      </div>
    );
  }
  return (
    <div className="sidebar-header">
      <BrandIcon brand={brand} />
      <div className="logo-text">
        {/* A name beside the console's own tile; beside a deployment's square logo only when configured. */}
        {(brand.appName || !brand.small) && <span className="n">{brand.appName ?? 'Kuma'}</span>}
        <span className="s">Access console</span>
      </div>
    </div>
  );
}

/** The brand at the top of a screen shown before the console (organisation choice, directory down). */
export function ScreenBrand({ brand = readBrand() }: { brand?: Brand }) {
  const [fullBroken, setFullBroken] = useState(false);
  return (
    <div className="screen-brand">
      {brand.full && !fullBroken
        ? <FullLogo brand={brand} onBroken={() => setFullBroken(true)} />
        : <><BrandIcon brand={brand} /><span className="n">{brand.appName ?? 'Kuma'}</span></>}
      <span className="s">Access console</span>
    </div>
  );
}
