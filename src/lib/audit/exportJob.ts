import type { AuditExportJob, ExportStatus } from '../../api/audit';

/** Polling an async export: quick at first, then every 5 s, and done once it is terminal. */
export function isTerminal(s: ExportStatus | undefined): boolean {
  return s === 'done' || s === 'failed';
}

export function pollDelay(attempt: number): number {
  return Math.min(5000, 1000 * 2 ** Math.max(0, attempt));
}

/** The toast when an export is ready (audit-tab.md §5.1). */
export function exportReadyMessage(job: AuditExportJob): string {
  const rows = job.rows != null ? `${job.rows.toLocaleString('en-US').replace(/,/g, ' ')} rows` : 'ready';
  const sha = job.sha256 ? ` · sha256 ${job.sha256.slice(0, 12)}…` : '';
  return `Export ready — ${rows}${sha}`;
}
