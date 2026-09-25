/**
 * Initials on a colour picked from the name, so the same person is the same colour everywhere.
 * The colour is computed, which is why this one component sets its background inline.
 */
export function Avatar({ name, email, size = 22 }: { name?: string; email?: string; size?: number }) {
  const src = name || email || '?';
  const initials = src.split(/\s+|@/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
  const hue = [...src].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const bg = `oklch(62% 0.13 ${hue})`;
  const bg2 = `oklch(52% 0.13 ${(hue + 30) % 360})`;
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${bg}, ${bg2})`, fontSize: Math.max(9, size * 0.42) }}
    >
      {initials}
    </span>
  );
}
