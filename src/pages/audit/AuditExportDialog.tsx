import { useState } from 'react';
import type { AuditQuery, ExportFormat } from '../../api/audit';
import { AUDIT_ERROR_COPY, auditApi, auditErrorKind } from '../../api/audit';
import { Button, Callout, Dialog, I, RadioGroup, Spinner } from '../../components/ui';
import { useApp } from '../../contexts/AppContext';
import { exportReadyMessage } from '../../lib/audit/exportJob';
import { useExportJob } from './queries';

/**
 * Export as an async job: jinbe streams the range from Loki to object storage and hands back a
 * signed link (15 min) with the row count and a sha256. The export is itself an audit event.
 */
export function AuditExportDialog({ open, onClose, query, rangeLabel }: {
  open: boolean; onClose: () => void; query: AuditQuery; rangeLabel: string;
}) {
  const { pushToast } = useApp();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const { job, error, start, reset } = useExportJob();
  const running = !!job && job.status !== 'done' && job.status !== 'failed';

  const run = async () => {
    const { from, to, ...filters } = query;
    const done = await start({ from, to, filters, format });
    if (done?.status === 'done') pushToast(exportReadyMessage(done));
  };
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const download = async (url: string) => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await auditApi.download(url, `audit-${query.from.slice(0, 10)}-${query.to.slice(0, 10)}.${format === 'csv' ? 'csv' : 'ndjson'}`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'The download failed.');
    } finally {
      setDownloading(false);
    }
  };
  const close = () => { if (!running) reset(); onClose(); };
  const errKind = error ? auditErrorKind(error) : null;

  return (
    <Dialog open={open} onClose={close} title="Export audit events" eyebrow={rangeLabel}
      footer={<>
        <Button onClick={close}>{job?.status === 'done' ? 'Close' : 'Cancel'}</Button>
        {job?.status !== 'done' && <Button variant="primary" icon={I.download} loading={running} onClick={() => void run()}>Start export</Button>}
      </>}>
      <div className="col gap-12">
        <RadioGroup label="Format" name="audit-export-format" value={format} onChange={setFormat} disabled={running}
          options={[
            { value: 'csv', label: 'CSV', hint: 'One row per event, the main columns' },
            { value: 'ndjson', label: 'NDJSON (full fields)', hint: 'Every field of every event, one JSON object per line' },
          ]} />
        <div className="small muted">Exports the current filters over the whole range, beyond the 5 000 entries the list shows. Exporting is recorded in the audit log.</div>
        {running && <div className="row gap-8 small"><Spinner label="Exporting" /> {job?.status === 'queued' ? 'Queued…' : 'Exporting…'}</div>}
        {job?.status === 'done' && (
          <Callout tone="success" icon={I.check} title={exportReadyMessage(job)}>
            {job.url ? <Button size="sm" className="mt-4" icon={I.download} loading={downloading} onClick={() => void download(job.url!)}>Download</Button>
              : <div className="small">The file is ready but no link came back.</div>}
            {job.truncated && <div className="small text-warning mt-4">The export hit its row limit: narrow the range for the rest.</div>}
            {job.sha256 && <div className="mono text-xs muted mt-4 audit-break">sha256 {job.sha256}</div>}
            <div className="text-xs muted mt-4">
              {job.expiresAt ? `Available until ${new Date(job.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Available for one hour.'}
            </div>
            {downloadError && <div className="small text-danger mt-4">{downloadError}</div>}
          </Callout>
        )}
        {job?.status === 'failed' && <Callout tone="danger" icon={I.alert} title="Export failed">{job.error ?? 'The export did not finish.'}</Callout>}
        {errKind && (
          <Callout tone={errKind === 'not-available' ? 'info' : 'danger'} icon={I.alert} title={AUDIT_ERROR_COPY[errKind].title}>
            {errKind === 'not-available' ? 'This server cannot export from the audit store yet.'
              : errKind === 'busy' ? 'You already have an export running — wait for it to finish.'
              : errKind === 'failed' && error instanceof Error ? error.message : AUDIT_ERROR_COPY[errKind].detail}
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
