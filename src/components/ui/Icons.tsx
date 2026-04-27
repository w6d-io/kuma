import React from 'react';

interface IconProps {
  d: React.ReactNode;
  size?: number;
  fill?: string;
  stroke?: string;
  sw?: number;
}

const Icon: React.FC<IconProps> = ({ d, size = 14, fill = "none", stroke = "currentColor", sw = 1.6 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export const I: Record<string, React.ReactElement> = {
  upload:   <Icon d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></>} />,
  sparkle:  <Icon d={<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></>} />,
  grid:     <Icon d={<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>} />,
  users:    <Icon d={<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>} />,
  group:    <Icon d={<><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M8 8h8M8 16h5"/></>} />,
  service:  <Icon d={<><rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="11" width="18" height="5" rx="1"/><circle cx="7" cy="6.5" r="0.8" fill="currentColor"/><circle cx="7" cy="13.5" r="0.8" fill="currentColor"/></>} />,
  role:     <Icon d={<><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/></>} />,
  route:    <Icon d={<><circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M5 8.5v7a3 3 0 0 0 3 3h3"/><path d="M19 15.5v-7a3 3 0 0 0-3-3h-3"/></>} />,
  gate:     <Icon d={<><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-9h6v9"/></>} />,
  audit:    <Icon d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6M9 9h2"/></>} />,
  search:   <Icon d={<><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>} />,
  close:    <Icon d={<><path d="M18 6 6 18M6 6l12 12"/></>} />,
  chev:     <Icon d={<><path d="m9 18 6-6-6-6"/></>} />,
  caret:    <Icon d={<><path d="m6 9 6 6 6-6"/></>} />,
  plus:     <Icon d={<><path d="M12 5v14M5 12h14"/></>} />,
  trash:    <Icon d={<><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></>} />,
  edit:     <Icon d={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></>} />,
  check:    <Icon d={<><path d="M20 6 9 17l-5-5"/></>} />,
  alert:    <Icon d={<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>} />,
  info:     <Icon d={<><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>} />,
  sync:     <Icon d={<><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>} />,
  git:      <Icon d={<><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7"/><path d="M8.5 6h4A3 3 0 0 1 15.5 9V10"/></>} />,
  clock:    <Icon d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>} />,
  shield:   <Icon d={<><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="m9 12 2 2 4-4"/></>} />,
  moon:     <Icon d={<><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>} />,
  sun:      <Icon d={<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>} />,
  more:     <Icon d={<><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>} />,
  filter:   <Icon d={<><path d="M22 3H2l8 9.46V19l4 2v-8.54z"/></>} />,
  globe:    <Icon d={<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>} />,
  box:      <Icon d={<><path d="M21 8V5a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 5v14a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 19z"/><path d="m3.27 6.96 8.73 5.04 8.73-5.04"/><path d="M12 22.08V12"/></>} />,
  key:      <Icon d={<><circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 10.15-10.15"/><path d="m17 5 3 3"/><path d="m14 8 3 3"/></>} />,
  cube:     <Icon d={<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></>} />,
  lock:     <Icon d={<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>} />,
  cog:      <Icon d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />,
  file:     <Icon d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>} />,
  dot:      <Icon d={<><circle cx="12" cy="12" r="3" fill="currentColor"/></>} />,
  download: <Icon d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>} />,
};
