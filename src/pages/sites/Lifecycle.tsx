import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, Field, I, Select } from '../../components/ui';
import type { BadgeTone, ButtonSize } from '../../components/ui';
import { sitesApi, useSitesPlatform } from '../../api/sites';
import { EPHEMERAL_DEFAULTS, expiryState, ttlChoices, ttlWords, type ExpiryTone } from '../../lib/sites/lifecycle';
import type { EphemeralView } from '../../lib/sites/types';
import { useSiteAction } from './useAction';

/**
 * An ephemeral site's expiry where the site is shown — its badge counting down on the list and the
 * site's header — and Extend, which moves the expiry to now + a TTL (sites:write). Expired means
 * paused by jinbe, never deleted; extending does not resume it.
 */

/** The clock a countdown reads, ticking every 30 s while something shows it. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const TONE: Record<ExpiryTone, BadgeTone> = { ok: 'info', soon: 'warning', expired: 'danger' };

export function EphemeralBadge({ e }: { e: EphemeralView }) {
  const now = useNow();
  const s = expiryState(e, now);
  return (
    <Badge tone={TONE[s.tone]} icon={I.clock} mono={false} title={s.detail}>
      {s.tone === 'expired' ? 'Expired (paused)' : `Ephemeral · ${s.label}`}
    </Badge>
  );
}

export function ExtendButton({ name, e, size = 'sm', onDone }: { name: string; e: EphemeralView; size?: ButtonSize; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const limits = useSitesPlatform().data?.ephemeral ?? EPHEMERAL_DEFAULTS;
  const choices = ttlChoices(limits);
  const [ttl, setTtl] = useState(() => (choices.includes(e.ttlSec) ? e.ttlSec : limits.defaultSec));
  const { run, busy } = useSiteAction();
  const extend = async () => {
    const out = await run('Extend', () => sitesApi.extend(name, ttl), `${name} extended: paused automatically in ${ttlWords(ttl)}`);
    if (!out) return;
    setOpen(false);
    onDone();
  };
  const expired = expiryState(e).tone === 'expired';
  return (
    <>
      <Button size={size} icon={I.clock} onClick={() => setOpen(true)}>Extend</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Extend this site"
        footer={<>
          <Button onClick={() => setOpen(false)} disabled={busy === 'Extend'}>Cancel</Button>
          <Button variant="primary" loading={busy === 'Extend'} onClick={() => void extend()}>Extend by {ttlWords(ttl)}</Button>
        </>}
      >
        <Field label="Keep it for" hint={`Counted from now. ${ttlWords(limits.minSec)} to ${ttlWords(limits.maxSec)}.`}>
          <Select value={ttl} onChange={(ev) => setTtl(Number(ev.target.value))}>
            {choices.map((s) => <option key={s} value={s}>{ttlWords(s)}</option>)}
          </Select>
        </Field>
        {expired && <p className="small muted mb-0">It has expired and stays paused: resume it from Settings to serve it again.</p>}
      </Dialog>
    </>
  );
}

/** The lifetime of a site about to be saved for the first time: permanent, or paused after a TTL. */
export function LifetimeField({ value, onChange, disabled }: { value: number | null; onChange: (ttl: number | null) => void; disabled?: boolean }) {
  const limits = useSitesPlatform().data?.ephemeral ?? EPHEMERAL_DEFAULTS;
  return (
    <Field label="Lifetime" hint={value ? 'Paused automatically when the time runs out, counted from the first save. Nothing is deleted; it can be extended.' : 'Stays until somebody deletes it.'}>
      <Select value={value ?? 0} disabled={disabled} onChange={(ev) => onChange(Number(ev.target.value) || null)}>
        <option value={0}>Permanent</option>
        {ttlChoices(limits).map((s) => <option key={s} value={s}>Ephemeral · {ttlWords(s)}</option>)}
      </Select>
    </Field>
  );
}
