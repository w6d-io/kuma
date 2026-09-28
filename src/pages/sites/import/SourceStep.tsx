import { useRef, useState } from 'react';
import { ActionBar, Button, Callout, Card, Checkbox, Field, FieldRow, FormGrid, I, Input, Select, Textarea } from '../../../components/ui';
import { AdvancedDisclosure } from '../../../components/ui/Primitives';
import type { ImportOptions } from '../../../api/siteImport';
import type { Gate } from '../../../lib/sites/types';
import { MAX_SPEC_BYTES } from '../../../lib/sites/openapiImport';

export interface SpecSource { content: string; fileName?: string; format: 'auto' | 'json' | 'yaml' }

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * Step 1: the document — a file, or its text pasted — and how its operations become routes. The
 * defaults suit most specs, so the options are folded away; the preview says what each one did.
 */
export function SourceStep({ source, onSource, options, onOptions, gates, busy, error, onPreview, onCancel }: {
  source: SpecSource;
  onSource: (s: SpecSource) => void;
  options: ImportOptions;
  onOptions: (o: ImportOptions) => void;
  gates: Gate[];
  busy: boolean;
  error: string | null;
  onPreview: () => void;
  onCancel: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const bytes = new TextEncoder().encode(source.content).length;
  const tooBig = bytes > MAX_SPEC_BYTES;
  const set = (patch: Partial<ImportOptions>) => onOptions({ ...options, ...patch });

  const pick = async (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (f.size > MAX_SPEC_BYTES) { setFileError(`${f.name} is ${mb(f.size)}; the import reads at most ${mb(MAX_SPEC_BYTES)}.`); return; }
    const text = await f.text();
    onSource({ content: text, fileName: f.name, format: /\.ya?ml$/i.test(f.name) ? 'yaml' : /\.json$/i.test(f.name) ? 'json' : 'auto' });
  };

  return (
    <Card title="The document" sub="An OpenAPI 3.x or Swagger 2.0 description of the site’s API, as JSON or YAML">
      <FormGrid>
        <Field label="File" hint={source.fileName ? `${source.fileName} · ${mb(bytes)}` : `Up to ${mb(MAX_SPEC_BYTES)} and 2 000 operations.`} error={fileError ?? undefined}>
          <div className="row gap-8 wrap">
            <input ref={file} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            <Button icon={I.upload} onClick={() => file.current?.click()}>{source.fileName ? 'Choose another file' : 'Choose a file'}</Button>
            {source.content && <Button variant="ghost" onClick={() => onSource({ content: '', format: 'auto' })}>Clear</Button>}
          </div>
        </Field>
        <Field label="Or paste it" error={tooBig ? `This is ${mb(bytes)}; the import reads at most ${mb(MAX_SPEC_BYTES)}.` : undefined}>
          <Textarea
            mono
            rows={10}
            spellCheck={false}
            placeholder={'openapi: 3.1.0\ninfo:\n  title: Billing API\n  version: 2.4.0\npaths: …'}
            value={source.content}
            onChange={(e) => onSource({ content: e.target.value, format: source.format, fileName: undefined })}
          />
        </Field>
        <AdvancedDisclosure label="How operations become routes" note="defaults suit most specs">
          <FormGrid>
            <FieldRow>
              <Field label="Base path" hint="The spec’s servers path, unless you set one.">
                <Input mono placeholder="/api/v1" value={options.basePath ?? ''} onChange={(e) => set({ basePath: e.target.value || undefined })} />
              </Field>
              <Field label="With the base path">
                <Select value={options.basePathMode ?? 'prepend'} onChange={(e) => set({ basePathMode: e.target.value as ImportOptions['basePathMode'] })}>
                  <option value="prepend">Put it before each path</option>
                  <option value="strip">Take it off each path</option>
                  <option value="none">Leave paths as they are</option>
                </Select>
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Permission resource from" hint="billing:read — where “billing” comes from.">
                <Select value={options.resourceFrom ?? 'tag'} onChange={(e) => set({ resourceFrom: e.target.value as ImportOptions['resourceFrom'] })}>
                  <option value="tag">The operation’s tag</option>
                  <option value="path">The first path segment</option>
                  <option value="operationId">The operation id</option>
                </Select>
              </Field>
              <Field label="Gate for imported routes" hint="The catch-all’s gate, unless you pick one.">
                <Select value={options.defaultGate ?? ''} onChange={(e) => set({ defaultGate: e.target.value || undefined })}>
                  <option value="">Same as Everything else</option>
                  {gates.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                </Select>
              </Field>
            </FieldRow>
            <Field label="Organization parameter" hint="A path parameter that names the organization (orgId…), limiting a route to members of that organization. Found by name when left empty.">
              <Input mono placeholder="orgId" value={options.orgParam ?? ''} onChange={(e) => set({ orgParam: e.target.value || undefined })} />
            </Field>
            <Checkbox checked={!!options.listAsRead} onChange={(v) => set({ listAsRead: v })} label="Treat list operations as reads" hint="GET on a collection needs …:read rather than …:list." />
          </FormGrid>
        </AdvancedDisclosure>
      </FormGrid>
      {error && <Callout tone="danger" icon={I.alert} className="mt-12">{error}</Callout>}
      <ActionBar divider className="mt-16" start={<span className="small muted">Nothing changes until you import; even then, only the draft.</span>}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!source.content.trim() || tooBig} onClick={onPreview}>Preview routes</Button>
      </ActionBar>
    </Card>
  );
}
