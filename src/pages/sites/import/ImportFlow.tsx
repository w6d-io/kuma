import { useState } from 'react';
import { Button, Card, I, Stepper } from '../../../components/ui';
import { importApi, type ImportOptions, type ImportPreview } from '../../../api/siteImport';
import { checksOf, useInvalidateSite } from '../../../api/sites';
import { describeImportError, toDecisions, type Picks } from '../../../lib/sites/openapiImport';
import type { SiteEditor } from '../useSiteEditor';
import type { Go } from '../SiteDetail';
import { SourceStep, type SpecSource } from './SourceStep';
import { MappingStep } from './MappingStep';

/**
 * Import from OpenAPI (Routes → Import): the document, then every operation mapped to a route with
 * its access and risk, then the import — into the DRAFT only. It lands on Review & apply with what
 * it wrote, so publishing stays the same deliberate step as for any change.
 *
 * The preview is jinbe's (it reads the spec in a bounded worker and keeps the exact bytes for the
 * commit); decisions stay here until "Check again" or the commit sends them.
 */
export function ImportFlow({ ed, go }: { ed: SiteEditor; go: Go }) {
  const invalidate = useInvalidateSite();
  const [source, setSource] = useState<SpecSource>({ content: '', format: 'auto' });
  const [options, setOptions] = useState<ImportOptions>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const [checked, setChecked] = useState<Picks>({});
  const [acceptDenied, setAcceptDenied] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gates = ed.site?.gates ?? [];
  const cancel = () => go('routes');

  const runPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      // The import is merged into the draft jinbe holds: local edits go there first.
      await ed.saveNow();
      await ed.settle();
      const out = await importApi.preview(ed.name, {
        source: { content: source.content, format: source.format },
        options: clean(options),
        decisions: preview ? toDecisions(preview.rows, picks) : [],
      });
      // Picks for operations the new preview no longer has are dropped.
      const ops = new Set(out.rows.map((r) => r.op));
      const kept = Object.fromEntries(Object.entries(picks).filter(([op]) => ops.has(op)));
      setPreview(out);
      setPicks(kept);
      setChecked(kept);
    } catch (err) {
      setError(describeImportError(err));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy('commit');
    setError(null);
    try {
      await ed.saveNow();
      await ed.settle();
      const out = await importApi.commit(ed.name, {
        specSha256: preview.spec.sha256,
        baseEtag: preview.base.etag,
        options: clean(options),
        decisions: toDecisions(preview.rows, picks),
        acceptDenied,
      });
      ed.reset();
      invalidate(ed.name);
      const c = out.counts;
      go('review', { imported: out.changed ? `${c.added ?? 0}.${c.changed ?? 0}.${c.removed ?? 0}` : 'none' });
    } catch (err) {
      // Rows refused at commit are marked in the table; the rest is said above the buttons.
      const refused = checksOf(err);
      if (refused.length) {
        const byOp = new Map(refused.map((c) => [c.path, c]));
        setPreview({ ...preview, rows: preview.rows.map((r) => (byOp.has(r.op) ? { ...r, blocking: { code: byOp.get(r.op)!.code, message: byOp.get(r.op)!.message } } : r)) });
        setChecked(picks);
      }
      setError(describeImportError(err));
    } finally {
      setBusy(null);
    }
  };

  const step = preview ? 'map' : 'source';
  return (
    <div className="stack gap-16">
      <Card
        title="Import from OpenAPI"
        sub="One route per operation of the spec, with its access and risk. Only the draft changes; publishing stays a separate step."
        actions={<Button size="sm" variant="ghost" icon={I.close} onClick={cancel}>Cancel import</Button>}
      >
        <Stepper
          current={step}
          onStep={(id) => { if (id === 'source') { setPreview(null); setError(null); } }}
          steps={[
            { id: 'source', label: 'Document', description: 'Upload or paste the spec' },
            { id: 'map', label: 'Map routes', description: 'Decide, confirm high risk' },
            { id: 'review', label: 'Review & apply', description: 'In the draft, then publish' },
          ]}
        />
      </Card>
      {step === 'source' ? (
        <SourceStep
          source={source}
          onSource={setSource}
          options={options}
          onOptions={setOptions}
          gates={gates}
          busy={busy === 'preview'}
          error={error}
          onPreview={() => void runPreview()}
          onCancel={cancel}
        />
      ) : (
        <MappingStep
          preview={preview!}
          picks={picks}
          onPicks={setPicks}
          checked={checked}
          acceptDenied={acceptDenied}
          onAcceptDenied={setAcceptDenied}
          gates={gates}
          busy={busy}
          error={error}
          onRecheck={() => void runPreview()}
          onBack={() => { setPreview(null); setError(null); }}
          onCommit={() => void commit()}
        />
      )}
    </div>
  );
}

/** Options as jinbe takes them: empty strings left out rather than sent (its schema refuses ''). */
function clean(o: ImportOptions): ImportOptions {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as ImportOptions;
}
