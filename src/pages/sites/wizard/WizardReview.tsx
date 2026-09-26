import { useEffect, useState } from 'react';
import { Callout, I } from '../../../components/ui';
import { sitesApi, type SiteError, notAvailable } from '../../../api/sites';
import { summarySentence } from '../../../lib/sites/templates';
import { checkCounts, riskLine } from '../../../lib/sites/diffWords';
import type { Preview, Site } from '../../../lib/sites/types';
import { CheckList, RiskBadge } from '../parts';
import { checkLines } from '../../../lib/sites/format';

/**
 * Step 4 — Review (site-ux.md §4.4): the sentence, then every check gatekit and jinbe run on the
 * rendered site. The draft is saved next; going live happens on the site's own Review.
 */
export function WizardReview({ site }: { site: Site }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(site);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    sitesApi.preview(site).then((p) => { if (!cancelled) setPreview(p); }).catch((err: SiteError) => {
      if (cancelled) return;
      setError(notAvailable(err) ? 'Preview is not available on this server yet.' : err.status === 503 ? 'Checks are unavailable (gatekit did not answer). You can save the draft; it cannot go live until checks run.' : err.message);
    });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = preview ? checkCounts(preview.checks) : null;
  return (
    <div className="stack gap-12">
      <p className="m-0 text-md">{summarySentence(site)}</p>
      {error && <Callout tone="warning" icon={I.alert}>{error}</Callout>}
      {!preview && !error && <CheckList lines={[{ level: 'pending', text: 'Rendering and checking against every live rule…' }]} />}
      {preview && (
        <>
          <p className="small m-0">{counts!.errors} blocking · {counts!.warnings} warning{counts!.warnings === 1 ? '' : 's'} · {preview.artefacts.rules.length} gateway rule{preview.artefacts.rules.length === 1 ? '' : 's'} · {preview.artefacts.routeMap.length} policy rows</p>
          <CheckList lines={preview.checks.length ? checkLines(preview.checks) : [{ level: 'ok', text: 'All checks passed.' }]} />
          <div className="row gap-8 items-center"><RiskBadge level={preview.risk.level} /><span className="small">{riskLine(preview.risk)}</span></div>
        </>
      )}
    </div>
  );
}
