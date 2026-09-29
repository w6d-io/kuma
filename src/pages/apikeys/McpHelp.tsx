import { useState } from 'react';
import { Card, CodeView, CopyField, Field, Tabs } from '../../components/ui';
import { useMcpStatus } from '../../api/hooks';
import { MCP_URL_PLACEHOLDER, mcpServerUrl } from '../../lib/apiKeys';
import { MCP_CLIENTS, MCP_KEY_ENV, MCP_KEY_PLACEHOLDER, exportKey, type McpClient } from '../../lib/mcpGuide';
import { McpClientSetup } from './McpClientSetup';

/**
 * How to connect an MCP client with a personal key: the server address, the key kept in an
 * environment variable, then the client — one tab each for Claude Code, Claude Desktop, Cursor,
 * VS Code and curl. With `secret`, the snippets carry the real key (just created); otherwise a
 * placeholder, never a key read back — keys cannot be read back.
 */
export function McpHelp({ secret, framed = true }: { secret?: string; framed?: boolean }) {
  // The address an administrator set (Settings → AI assistants), else the console's MCP_SERVER_URL.
  const status = useMcpStatus();
  const url = status.data?.serverUrl?.replace(/\/$/, '') || mcpServerUrl();
  const [client, setClient] = useState<McpClient>('claude-code');
  const idBase = framed ? 'mcp-client' : 'mcp-client-new';
  const body = (
    <ol className="mcp-steps">
      <li>
        <div className="fw-medium">The MCP server</div>
        {url
          ? <Field label="Server URL" className="mt-4"><CopyField value={url} size="sm" /></Field>
          : <p className="small muted m-0">This platform has not published its MCP address here. Ask an administrator for it; it looks like <span className="mono">{MCP_URL_PLACEHOLDER}</span>.</p>}
      </li>
      <li>
        <div className="fw-medium">{secret ? 'Keep the key in an environment variable' : 'Create a key, then keep it in an environment variable'}</div>
        <p className="small muted m-0">
          In your shell profile or from a secret manager — never in a file you commit. The client sends it
          as <span className="mono">Authorization: Bearer …</span> and then acts as you, with the key’s
          permissions — never more than you hold now.
        </p>
        <CodeView className="mt-8" title={`${MCP_KEY_ENV}`} language="shell" code={exportKey(secret ?? MCP_KEY_PLACEHOLDER)} wrap />
      </li>
      <li>
        <div className="fw-medium">Add the server to your client</div>
        <Tabs className="mt-8" label="MCP client" idBase={idBase} items={[...MCP_CLIENTS]} value={client} onChange={setClient} />
        <div role="tabpanel" id={`${idBase}-panel-${client}`} aria-labelledby={`${idBase}-tab-${client}`} className="mt-8">
          <McpClientSetup client={client} url={url || MCP_URL_PLACEHOLDER} apiKey={secret ?? MCP_KEY_PLACEHOLDER} />
        </div>
      </li>
    </ol>
  );
  return framed ? <Card title="Connect an MCP client" sub="An AI assistant or any client that speaks the Model Context Protocol">{body}</Card> : body;
}
