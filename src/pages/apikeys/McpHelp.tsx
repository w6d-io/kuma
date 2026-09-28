import { Card, CodeView, CopyField, Field } from '../../components/ui';
import { useMcpStatus } from '../../api/hooks';
import { MCP_URL_PLACEHOLDER, mcpConfig, mcpServerUrl } from '../../lib/apiKeys';

/**
 * How to connect an MCP client with a personal key: the server address, then the key pasted as its
 * bearer header. With `secret`, the snippet carries the real key (just created); otherwise a
 * placeholder, never a key read back — keys cannot be read back.
 */
export function McpHelp({ secret, framed = true }: { secret?: string; framed?: boolean }) {
  // The address an administrator set (Settings → AI assistants), else the console's MCP_SERVER_URL.
  const status = useMcpStatus();
  const url = status.data?.serverUrl?.replace(/\/$/, '') || mcpServerUrl();
  const body = (
    <ol className="mcp-steps">
      <li>
        <div className="fw-medium">Point the client at the MCP server</div>
        {url
          ? <Field label="Server URL" className="mt-4"><CopyField value={url} size="sm" /></Field>
          : <p className="small muted m-0">This platform has not published its MCP address here. Ask an administrator for it; it looks like <span className="mono">{MCP_URL_PLACEHOLDER}</span>.</p>}
      </li>
      <li>
        <div className="fw-medium">{secret ? 'Paste the key as its bearer token' : 'Create a key, then paste it as the bearer token'}</div>
        <p className="small muted m-0">Most clients take a JSON configuration like this one. The client then acts as you, in the key’s organization, with the key’s scopes — never more than you hold there now.</p>
        <CodeView className="mt-8" title="MCP client configuration" language="json" code={mcpConfig(url || MCP_URL_PLACEHOLDER, secret ?? 'stk_mcp_…')} wrap />
      </li>
    </ol>
  );
  return framed ? <Card title="Connect an MCP client" sub="An AI assistant or any client that speaks the Model Context Protocol">{body}</Card> : body;
}
