import { useEffect, useState } from 'react';
import { Badge, Field, I, Input, Segmented } from '../ui';
import { EXPIRY_PRESETS, expiresInWords, expiryFrom, expiryTone, type ExpiryPreset } from '../../lib/grants';

/**
 * When a grant ends: 1 day, 1 week, 1 month, a date, or never. Reports the ISO end (null: never) and
 * whether the choice is usable; a custom date must be in the future.
 */
export function ExpiryPicker({ onChange, initial = 'never' }: {
  onChange: (v: { expiresAt: string | null; invalid: boolean }) => void;
  initial?: ExpiryPreset;
}) {
  const [preset, setPreset] = useState<ExpiryPreset>(initial);
  const [date, setDate] = useState('');
  const value = expiryFrom(preset, date);
  // The parent keeps the computed end; it is recomputed when the choice changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onChange(value); }, [preset, date]);

  return (
    <Field label={<>Expires <span className="muted">(optional)</span></>} hint="When it passes, the grant stops counting. Nothing else changes." error={preset === 'custom' && date && value.invalid ? 'Pick a date in the future.' : undefined}>
      <div className="row wrap gap-8 items-center">
        <Segmented label="Expires" value={preset} onChange={setPreset} options={EXPIRY_PRESETS} />
        {preset === 'custom' && <Input size="sm" type="date" aria-label="Expiry date" value={date} onChange={(e) => setDate(e.target.value)} />}
        {value.expiresAt && <ExpiresBadge expiresAt={value.expiresAt} />}
      </div>
    </Field>
  );
}

/** "expires in 3 days": the countdown, warning within a day, danger once past. Refreshed every minute. */
export function ExpiresBadge({ expiresAt }: { expiresAt: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const tone = expiryTone(expiresAt, now);
  const title = expiresAt ? new Date(expiresAt).toLocaleString() : 'Stays until somebody removes it';
  if (tone === 'never') return <span className="small muted nowrap" title={title}>no expiry</span>;
  return (
    <Badge tone={tone === 'expired' ? 'danger' : tone === 'soon' ? 'warning' : 'neutral'} icon={I.clock} mono={false} title={title}>
      {expiresInWords(expiresAt, now)}
    </Badge>
  );
}
