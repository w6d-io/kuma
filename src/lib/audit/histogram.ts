/**
 * The events-over-time strip. Bars are drawn as SVG rects scaled to the tallest bucket; a bucket
 * with events is never drawn thinner than one pixel, so a lone denial does not vanish.
 */
export interface Bar { t: string; total: number; failed: number; h: number; hf: number }

export function toBars(series: { t: string; total: number; failed?: number }[], height: number): Bar[] {
  const max = Math.max(0, ...series.map((s) => s.total));
  const scale = (n: number) => (max === 0 || n === 0 ? 0 : Math.max(1, Math.round((n / max) * height)));
  return series.map((s) => ({ t: s.t, total: s.total, failed: s.failed ?? 0, h: scale(s.total), hf: scale(Math.min(s.failed ?? 0, s.total)) }));
}

/** The width of one bucket, from the spacing of the series (falls back to an hour). */
export function bucketMs(series: { t: string }[]): number {
  if (series.length < 2) return 3_600_000;
  const d = Date.parse(series[1].t) - Date.parse(series[0].t);
  return Number.isFinite(d) && d > 0 ? d : 3_600_000;
}

/** The summary window jinbe understands for a range preset. */
export function summaryWindow(range: string): string | null {
  return ['1h', '24h', '7d', '30d'].includes(range) ? range : null;
}
