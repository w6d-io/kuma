import { describe, expect, it } from 'vitest';
import { MCP_KEY_ENV, MCP_SERVER_NAME, claudeCode, claudeDesktop, cursor, curl, exportKey, mcpKeyEnv, mcpServerName, vscode } from './mcpGuide';

// The snippets developers paste: exact syntax per client, and no key in any file a project commits.
const URL = 'https://mcp.example.com/mcp';

describe('mcpGuide snippets', () => {
  it('exports the key single-quoted, so the shell expands nothing inside', () => {
    expect(exportKey('stk_mcp_a.b')).toBe("export KUMA_MCP_KEY='stk_mcp_a.b'");
    expect(exportKey("it's")).toBe("export KUMA_MCP_KEY='it'\\''s'");
  });

  it('Claude Code: user scope expands the variable now, project scope keeps it literal for .mcp.json', () => {
    expect(claudeCode.user(URL)).toBe(`claude mcp add --transport http --scope user kuma ${URL} \\\n  --header "Authorization: Bearer $KUMA_MCP_KEY"`);
    expect(claudeCode.project(URL)).toContain(`--scope project kuma ${URL}`);
    expect(claudeCode.project(URL)).toContain("--header 'Authorization: Bearer ${KUMA_MCP_KEY}'");
  });

  it('Claude Desktop bridges with mcp-remote, the key in env and not in args', () => {
    const cfg = JSON.parse(claudeDesktop(URL, 'stk_mcp_a.b'));
    expect(cfg.mcpServers.kuma).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-remote', URL, '--header', 'Authorization:${AUTH_HEADER}'],
      env: { AUTH_HEADER: 'Bearer stk_mcp_a.b' },
    });
  });

  it('Cursor reads the variable, VS Code prompts for the key: neither file holds it', () => {
    expect(JSON.parse(cursor(URL))).toEqual({ mcpServers: { kuma: { url: URL, headers: { Authorization: 'Bearer ${env:KUMA_MCP_KEY}' } } } });
    const vs = JSON.parse(vscode(URL));
    expect(vs.servers.kuma).toEqual({ type: 'http', url: URL, headers: { Authorization: 'Bearer ${input:kuma-mcp-key}' } });
    expect(vs.inputs[0]).toMatchObject({ type: 'promptString', id: 'kuma-mcp-key', password: true });
    expect(cursor(URL) + vscode(URL)).not.toMatch(/stk_mcp_[A-Za-z0-9]/);
  });

  it('curl sends the headers Streamable HTTP needs and valid JSON-RPC bodies', () => {
    for (const s of [curl.initialize(URL), curl.toolsList(URL), curl.whoami(URL)]) {
      expect(s).toContain("-H 'Accept: application/json, text/event-stream'");
      expect(s).toContain('-H "Authorization: Bearer $KUMA_MCP_KEY"');
      const body = JSON.parse(/-d '(.*)'$/.exec(s)![1]);
      expect(body.jsonrpc).toBe('2.0');
    }
    expect(curl.toolsList(URL)).toContain('"method":"tools/list"');
    expect(curl.whoami(URL)).toContain('"name":"whoami"');
  });
});

// The server name and the key variable are the deployment's (MCP_SERVER_NAME); the history scrub had
// left them as "example" / example_MCP_KEY in every snippet.
describe('server name', () => {
  it('defaults to kuma, read from KUMA_MCP_KEY', () => {
    expect(mcpServerName(undefined)).toBe('kuma');
    expect(mcpServerName('${MCP_SERVER_NAME}')).toBe('kuma');
    expect(MCP_SERVER_NAME).toBe('kuma');
    expect(MCP_KEY_ENV).toBe('KUMA_MCP_KEY');
  });
  it('takes a valid name and derives the variable from it', () => {
    expect(mcpServerName(' kuma-dev ')).toBe('kuma-dev');
    expect(mcpKeyEnv('kuma-dev')).toBe('KUMA_DEV_MCP_KEY');
    expect(mcpKeyEnv('acme2')).toBe('ACME2_MCP_KEY');
  });
  it('refuses a name a client or a shell would choke on', () => {
    for (const bad of ['Kuma', '-kuma', 'kuma dev', 'kuma_dev', 'kuma;rm', 'a'.repeat(42), '']) expect(mcpServerName(bad)).toBe('kuma');
  });
});
