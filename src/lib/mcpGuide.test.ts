import { describe, expect, it } from 'vitest';
import { claudeCode, claudeDesktop, cursor, curl, exportKey, vscode } from './mcpGuide';

// The snippets developers paste: exact syntax per client, and no key in any file a project commits.
const URL = 'https://mcp.example.com/mcp';

describe('mcpGuide snippets', () => {
  it('exports the key single-quoted, so the shell expands nothing inside', () => {
    expect(exportKey('stk_mcp_a.b')).toBe("export example_MCP_KEY='stk_mcp_a.b'");
    expect(exportKey("it's")).toBe("export example_MCP_KEY='it'\\''s'");
  });

  it('Claude Code: user scope expands the variable now, project scope keeps it literal for .mcp.json', () => {
    expect(claudeCode.user(URL)).toBe(`claude mcp add --transport http --scope user example ${URL} \\\n  --header "Authorization: Bearer $example_MCP_KEY"`);
    expect(claudeCode.project(URL)).toContain(`--scope project example ${URL}`);
    expect(claudeCode.project(URL)).toContain("--header 'Authorization: Bearer ${example_MCP_KEY}'");
  });

  it('Claude Desktop bridges with mcp-remote, the key in env and not in args', () => {
    const cfg = JSON.parse(claudeDesktop(URL, 'stk_mcp_a.b'));
    expect(cfg.mcpServers.example).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-remote', URL, '--header', 'Authorization:${AUTH_HEADER}'],
      env: { AUTH_HEADER: 'Bearer stk_mcp_a.b' },
    });
  });

  it('Cursor reads the variable, VS Code prompts for the key: neither file holds it', () => {
    expect(JSON.parse(cursor(URL))).toEqual({ mcpServers: { example: { url: URL, headers: { Authorization: 'Bearer ${env:example_MCP_KEY}' } } } });
    const vs = JSON.parse(vscode(URL));
    expect(vs.servers.example).toEqual({ type: 'http', url: URL, headers: { Authorization: 'Bearer ${input:example-mcp-key}' } });
    expect(vs.inputs[0]).toMatchObject({ type: 'promptString', id: 'example-mcp-key', password: true });
    expect(cursor(URL) + vscode(URL)).not.toMatch(/stk_mcp_[A-Za-z0-9]/);
  });

  it('curl sends the headers Streamable HTTP needs and valid JSON-RPC bodies', () => {
    for (const s of [curl.initialize(URL), curl.toolsList(URL), curl.whoami(URL)]) {
      expect(s).toContain("-H 'Accept: application/json, text/event-stream'");
      expect(s).toContain('-H "Authorization: Bearer $example_MCP_KEY"');
      const body = JSON.parse(/-d '(.*)'$/.exec(s)![1]);
      expect(body.jsonrpc).toBe('2.0');
    }
    expect(curl.toolsList(URL)).toContain('"method":"tools/list"');
    expect(curl.whoami(URL)).toContain('"name":"whoami"');
  });
});
