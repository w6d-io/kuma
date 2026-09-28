import { useMemo } from 'react';
import { ActionTile, BarSeries, HealthItem, I, Kpi, Meter, QueueItem, RelativeTime, SourceState } from '../../components/ui';
import { activity } from '../../lib/home/fixtures';
import { SectionTitle, Specimen, State } from './Specimen';

/** The briefing pieces the Home is built from: figures, charts, queue rows, health, honest gaps. */
export function DataSection() {
  const now = useMemo(() => Date.now(), []);
  const a = useMemo(() => activity(now), [now]);
  const ago = (ms: number) => new Date(now - ms).toISOString();
  return (
    <>
      <SectionTitle id="data" title="Data & briefing" sub="Every number has a range and a link; status is a square or an icon with words; an absent source is said, never drawn as a zero." />
      <Specimen name="BarSeries" note="Two stacked series in --chart-pass / --chart-fail. One bar in the tab order, arrow keys move; hover or focus shows the figures; View as table gives them as rows." wide>
        <BarSeries buckets={a.series.map((b) => ({ t: b.t, a: b.succeeded, b: b.failed }))} labels={{ a: 'signed in', b: 'failed' }} summary="Sign-ins, last 24 h" />
      </Specimen>
      <div className="specimen-grid">
        <Specimen name="Kpi" note="Label, tabular value, one line under it. The line is coloured only when a rule fired, and says so in words.">
          <div className="kpi-row">
            <Kpi label="Signed in" value="342" sub="−8% vs previous 24 h" href="#/design" />
            <Kpi label="Failed sign-ins" value="21" sub="3× usual" tone="warning" icon={I.trendUp} href="#/design" />
            <Kpi label="People" value="118" sub="signed in" />
          </div>
        </Specimen>
        <Specimen name="Meter" note="A share as a thin neutral bar, the figure always beside it.">
          <Meter value={292} of={412} label="Second factor" />
        </Specimen>
        <Specimen name="HealthItem" note="A square in the state's colour, neutral grey for unknown or not deployed; the words always there.">
          <State label="ok"><HealthItem label="Policy engine" state="ok" summary="2/2 in sync" /></State>
          <State label="degraded"><HealthItem label="Audit log" state="degraded" summary="archive 3 min behind" /></State>
          <State label="down"><HealthItem label="Policy sync" state="down" summary="34 min ago" /></State>
          <State label="not deployed"><HealthItem label="Gateway" state="not_deployed" summary="CRD absent" /></State>
        </Specimen>
        <Specimen name="SourceState" note="The honest not connected: what is missing, what it will show, the setting and the docs.">
          <SourceState title="Gateway traffic isn't connected yet" setting="opa-authz-proxy decision log (OBS-1.4)" docs="docs/research/obs-flow.md#36" compact>
            Allow and deny by site come from the gateway's decision log.
          </SourceState>
        </Specimen>
        <Specimen name="QueueItem" note="A real link. Critical and warning carry the 3px bar; the severity is read out in words.">
          <div className="panel">
            <QueueItem severity="critical" title="Apply request for Payroll v8" detail="Sam Ortiz · high risk" age="12 min" href="#/design" />
            <QueueItem severity="warning" title="Expenses drifted from what was applied" age="2 h" href="#/design" actionable={false} />
            <QueueItem severity="info" title="5 people are in no group" age="9 d" href="#/design" />
          </div>
        </Specimen>
        <Specimen name="ActionTile" note="A verb that opens its flow, with its key.">
          <div className="action-grid">
            <ActionTile icon={I.plus} verb="Plug a site" kbd="n" href="#/design" />
            <ActionTile icon={I.gate} verb="Gateway" hint="Asks for your second factor" onClick={() => {}} />
          </div>
        </Specimen>
        <Specimen name="RelativeTime" note="A <time>, the absolute moment on hover, kept current every 30 s.">
          <State label="minutes"><RelativeTime at={ago(12 * 60_000)} /></State>
          <State label="days"><RelativeTime at={ago(3 * 86_400_000)} /></State>
          <State label="unknown"><RelativeTime at={null} /></State>
        </Specimen>
      </div>
    </>
  );
}
