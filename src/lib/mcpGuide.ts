/**
 * The snippets of the "Connect an MCP client" guide, one set per client. Pure strings, so the guide
 * and its tests read the same text. `key` is the key just created (shown once) or the placeholder;
 * every client reads it from example_MCP_KEY (or its own secret store), so no snippet puts a key in
 * a file a project could commit.
 */

/** The name each client lists the server under. */
export const MCP_SERVER_NAME = 'example';
/** Where the snippets read the key from. */
export const MCP_KEY_ENV = 'example_MCP_KEY';
/** Stands for a key in the snippets when none was just created. */
export const MCP_KEY_PLACEHOLDER = 'stk_mcp_<your key>';

export type McpClient = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode' | 'curl';

export const MCP_CLIENTS: ReadonlyArray<{ value: McpClient; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'claude-desktop', label: 'Claude Desktop' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'curl', label: 'curl' },
];

const json = (v: unknown) => JSON.stringify(v, null, 2);
// Single quotes: a key has no quote in it, and the shell must not expand anything inside.
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Keeps the key out of files: in the shell (or a profile / secret manager that exports it). */
export const exportKey = (key: string) => `export ${MCP_KEY_ENV}=${q(key)}`;

export const claudeCode = {
  /** Just you, every project: stored in ~/.claude.json with the key expanded now. */
  user: (url: string) =>
    `claude mcp add --transport http --scope user ${MCP_SERVER_NAME} ${url} \\\n  --header "Authorization: Bearer $${MCP_KEY_ENV}"`,
  /** The team, in .mcp.json (committed): the variable stays literal, each person sets their own key. */
  project: (url: string) =>
    `claude mcp add --transport http --scope project ${MCP_SERVER_NAME} ${url} \\\n  --header 'Authorization: Bearer \${${MCP_KEY_ENV}}'`,
  verify: `claude mcp get ${MCP_SERVER_NAME}\n# then, inside a Claude Code session:\n/mcp`,
};

/** Claude Desktop only starts local (stdio) servers from its file: mcp-remote bridges to this one. */
export const claudeDesktop = (url: string, key: string) =>
  json({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: 'npx',
        // No space after the colon: some platforms split arguments on it.
        args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
        env: { AUTH_HEADER: `Bearer ${key}` },
      },
    },
  });

export const CLAUDE_DESKTOP_PATHS = {
  mac: '~/Library/Application Support/Claude/claude_desktop_config.json',
  windows: '%APPDATA%\\Claude\\claude_desktop_config.json',
};

/** ~/.cursor/mcp.json: Cursor resolves ${env:…} from the environment it was started in. */
export const cursor = (url: string) =>
  json({ mcpServers: { [MCP_SERVER_NAME]: { url, headers: { Authorization: `Bearer \${env:${MCP_KEY_ENV}}` } } } });

/** VS Code asks for the key once and keeps it in its secret storage, never in the file. */
export const vscode = (url: string) =>
  json({
    inputs: [{ type: 'promptString', id: 'example-mcp-key', description: 'example MCP key (stk_mcp_…)', password: true }],
    servers: { [MCP_SERVER_NAME]: { type: 'http', url, headers: { Authorization: 'Bearer ${input:example-mcp-key}' } } },
  });

const rpc = (id: number, method: string, params?: unknown) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

/** A request to the server with curl: the headers every MCP request needs, then the JSON-RPC body. */
function curlCall(url: string, body: string) {
  return [
    `curl -s ${url} \\`,
    `  -H "Authorization: Bearer $${MCP_KEY_ENV}" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Accept: application/json, text/event-stream' \\`,
    `  -d ${q(body)}`,
  ].join('\n');
}

export const curl = {
  initialize: (url: string) =>
    curlCall(url, rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '0' } })),
  toolsList: (url: string) => curlCall(url, rpc(2, 'tools/list')),
  whoami: (url: string) => curlCall(url, rpc(3, 'tools/call', { name: 'whoami', arguments: {} })),
};

/** What the server answers when it refuses, and what to do about it. */
export const MCP_TROUBLESHOOTING: ReadonlyArray<{ answer: string; meaning: string; fix: string }> = [
  {
    answer: '401 invalid_key / invalid_token',
    meaning: 'The key expired, was revoked, or is incomplete — it is the whole stk_mcp_<id>.<secret> value, after "Bearer ".',
    fix: 'Check the variable is set in the shell that starts the client. Otherwise create a new key. A client that opens a browser to sign in got this answer too.',
  },
  {
    answer: '403 mcp_disabled — turned off by an administrator',
    meaning: 'An administrator switched AI assistants off (Settings → AI assistants).',
    fix: 'Nothing to fix on your side: your keys are kept and work again when it is switched back on.',
  },
  {
    answer: '403 mcp_disabled — not enabled for your groups',
    meaning: 'AI assistants are limited to some groups, and you are in none of them.',
    fix: 'Ask a platform administrator to add one of your groups in Settings → AI assistants.',
  },
  {
    answer: '503 retry_later / unavailable',
    meaning: 'The platform could not check your key or your permissions just now (authz_unavailable).',
    fix: 'Retry in a few seconds. It is never a yes by default.',
  },
  {
    answer: 'Tool error insufficient_scope',
    meaning: 'The key was created with chosen permissions, and this tool needs another one.',
    fix: 'Create a key with that permission, or with all your permissions.',
  },
  {
    answer: 'Tool error forbidden / delegation_refused',
    meaning: 'Your account does not hold that permission, or the action is never allowed through a key.',
    fix: 'Do it in the console, or ask an administrator.',
  },
];

/** What a key can never do, whatever permissions it carries (jinbe's delegation gate). */
export const MCP_ALWAYS_REFUSED: readonly string[] = [
  'Delete anything — a site, a user, a group, a zone, a membership, a session: deletes are made by hand in the console',
  'Create keys (revoking one is allowed), reset a second factor, approve a request',
  'Change sign-in or AI-assistant settings, zones or the gateway, group and role definitions, or anything about your own account',
  'Export the policy bundle or the audit log in bulk',
  'Publish, change an email or grant a group with a key created without “protected actions”, or more than 30 days after its second factor',
];
