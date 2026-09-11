import React from 'react';

/**
 * Placeholders in the shape of what is coming.
 *
 * A page that swaps a spinner — or nothing — for a full table moves everything under the reader's
 * eyes at once. A block the size of the row that will land holds the layout still, so the arrival is
 * a change of content rather than a change of shape.
 *
 * The shimmer is decoration: `prefers-reduced-motion` stops it and the block stays. Every one of
 * these is `aria-hidden`, and the region that owns them carries `aria-busy` — a reader should be
 * told "loading", not read a wall of empty boxes.
 */

export function Skeleton({ w, h = 12, radius = 4, style }: {
  w?: number | string;
  h?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return <span className="skeleton" aria-hidden="true" style={{ width: w ?? '100%', height: h, borderRadius: radius, ...style }} />;
}

/** Lines of prose or labels. The last one is short, the way a paragraph ends. */
export function SkeletonText({ lines = 3, width = '100%' }: { lines?: number; width?: number | string }) {
  return (
    <span className="skeleton-stack" aria-hidden="true" style={{ width }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}

/**
 * Rows in a table that is already on screen, so the header and the column widths do not move when
 * the data lands. `cols` is the real column count: a short row would let the browser re-measure.
 */
export function SkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skeleton-row" aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}><Skeleton w={c === 0 ? '70%' : c === cols - 1 ? '40%' : '55%'} /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** A panel's worth of content, for a page that has no table to hold its shape. */
export function SkeletonPanel({ lines = 4 }: { lines?: number }) {
  return (
    <div className="panel skeleton-panel" aria-hidden="true">
      <Skeleton w="28%" h={16} />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** A row of summary tiles. */
export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-tiles" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel skeleton-tile">
          <Skeleton w="50%" h={10} />
          <Skeleton w="35%" h={22} />
        </div>
      ))}
    </div>
  );
}
