import { memo, useState } from 'react';
import { API_BASE } from '../api/client';

/**
 * ServiceFavicon — shows a service's website favicon, fetched & cached
 * server-side by jinbe (GET /admin/rbac/services/:name/favicon). jinbe pulls the
 * icon from the service's OWN public host in-cluster, so the browser never calls
 * out to a third-party favicon service.
 *
 * The endpoint returns 204 No Content when there is no favicon; an <img> treats
 * that (and any fetch/decoding error) as a load error, so `onError` drives the
 * fallback: a tidy, colour-hashed initial-letter avatar of the service name
 * (consistent per service) rather than a broken-image glyph.
 */

function initial(name: string): string {
  const c = name.trim()[0];
  return c ? c.toUpperCase() : '?';
}

// Stable hue from the service name (same hashing as the user Avatar) so a given
// service always falls back to the same colour.
function hueOf(name: string): number {
  return [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
}

export const ServiceFavicon = memo(function ServiceFavicon({ name, size = 16 }: { name: string; size?: number }) {
  // Track failure per-name: if the same DOM slot is reused for a different
  // service (list filtering), `failed` auto-resets because the names differ —
  // no effect needed.
  const [failedName, setFailedName] = useState<string | null>(null);
  const failed = failedName === name;

  if (failed) {
    const hue = hueOf(name);
    return (
      <span
        aria-hidden="true"
        title={name}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          borderRadius: Math.max(3, Math.round(size * 0.22)),
          background: `linear-gradient(135deg, oklch(62% 0.13 ${hue}), oklch(52% 0.13 ${(hue + 30) % 360}))`,
          color: '#fff',
          fontWeight: 600,
          fontSize: Math.max(8, Math.round(size * 0.6)),
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        {initial(name)}
      </span>
    );
  }

  return (
    <img
      src={`${API_BASE}/admin/rbac/services/${encodeURIComponent(name)}/favicon`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailedName(name)}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        objectFit: 'contain',
        borderRadius: Math.max(2, Math.round(size * 0.18)),
        display: 'block',
      }}
    />
  );
});
