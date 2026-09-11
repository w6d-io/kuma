import React from 'react';

/**
 * The console's icons, from Font Awesome.
 *
 * They were hand-drawn SVG paths, and a handful of emoji before that. Emoji are the worst of the
 * three: every platform draws them differently, they carry a colour nobody chose, they sit off the
 * text baseline, and the lock one operating system renders is not the lock the next person sees.
 * The drawn paths fixed the colour and the baseline but not the drift — each new one was a fresh
 * guess at a shape somebody had already solved.
 *
 * Font Awesome is the set the other Strada front already uses, bundled from the package rather than
 * fetched from a CDN, so nothing here depends on a third party being reachable.
 *
 * `aria-hidden` on every one: an icon beside a label repeats it, and a reader announcing both says
 * everything twice. Where an icon stands ALONE, the call site carries the name — `title` and
 * `aria-label` on the button, never here.
 */
const icon = (name: string): React.ReactElement => (
  <i className={`fa-solid fa-${name}`} aria-hidden="true" />
);

export const I: Record<string, React.ReactElement> = {
  // Navigation
  grid: icon('table-cells-large'),
  users: icon('users'),
  group: icon('user-group'),
  service: icon('cube'),
  globe: icon('globe'),
  audit: icon('file-lines'),
  shield: icon('shield-halved'),
  box: icon('box-archive'),
  cog: icon('gear'),
  menu: icon('bars'),

  // Actions
  plus: icon('plus'),
  edit: icon('pen-to-square'),
  trash: icon('trash'),
  search: icon('magnifying-glass'),
  close: icon('xmark'),
  filter: icon('filter'),
  more: icon('ellipsis'),
  sync: icon('rotate'),
  upload: icon('upload'),
  download: icon('download'),
  arrowOut: icon('arrow-up-right-from-square'),

  // State
  check: icon('check'),
  alert: icon('triangle-exclamation'),
  info: icon('circle-info'),
  lock: icon('lock'),
  key: icon('key'),
  clock: icon('clock'),
  dot: icon('circle'),

  // Disclosure
  caret: icon('chevron-down'),
  caretUp: icon('chevron-up'),
  caretRight: icon('chevron-right'),
  chev: icon('chevron-right'),

  // Trend, in the audit summary
  trendUp: icon('arrow-trend-up'),
  trendDown: icon('arrow-trend-down'),
  trendFlat: icon('minus'),

  // Theme, in the rail
  sun: icon('sun'),
  moon: icon('moon'),
  // Neither one nor the other, because it follows something else.
  contrast: icon('circle-half-stroke'),

  // Policy objects
  role: icon('id-badge'),
  route: icon('route'),
  gate: icon('shield-halved'),
  cube: icon('cube'),
  file: icon('file'),
  git: icon('code-branch'),
  sparkle: icon('wand-magic-sparkles'),
};
