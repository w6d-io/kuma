import type { ReactNode } from 'react';
import { CodeView } from '../../components/ui';
import {
  CLAUDE_DESKTOP_PATHS, MCP_KEY_ENV, MCP_SERVER_NAME, claudeCode, claudeDesktop, cursor, curl, vscode, type McpClient,
} from '../../lib/mcpGuide';

/** One client's setup: a few numbered lines, each with the snippet it needs. */
function Steps({ children }: { children: ReactNode }) {
  return <ol className="mcp-client-steps small">{children}</ol>;
}

const env = <span className="mono">{MCP_KEY_ENV}</span>;
const mono = (s: string) => <span className="mono">{s}</span>;

/**
 * How to add the server to one MCP client. `url` is the server address; `apiKey` the key just created
 * or the placeholder — only Claude Desktop writes it into its file, the others read ${MCP_KEY_ENV} or
 * keep it in their own secret storage.
 */
export function McpClientSetup({ client, url, apiKey }: { client: McpClient; url: string; apiKey: string }) {
  switch (client) {
    case 'claude-code':
      return (
        <Steps>
          <li>
            Just for you, in every project (kept in {mono('~/.claude.json')}; the key is read from {env} now):
            <CodeView className="mt-4" title="Terminal" language="shell" code={claudeCode.user(url)} wrap />
          </li>
          <li>
            Or for the whole team, in the project’s {mono('.mcp.json')}: the file names the variable, never the
            key, so it can be committed and each developer sets their own {env}.
            <CodeView className="mt-4" title="Terminal" language="shell" code={claudeCode.project(url)} wrap />
          </li>
          <li>
            Check it: <span className="mono">{MCP_SERVER_NAME}</span> should read <em>connected</em>, with its tools listed
            under {mono('/mcp')}. Remove it with {mono(`claude mcp remove ${MCP_SERVER_NAME} --scope user`)}.
            <CodeView className="mt-4" title="Check" language="shell" code={claudeCode.verify} />
          </li>
        </Steps>
      );
    case 'claude-desktop':
      return (
        <Steps>
          <li>
            Claude Desktop starts only local servers from its configuration file, so the small
            {' '}{mono('mcp-remote')} bridge (Node.js 18 or later) connects it to this one. Custom connectors in
            Settings → Connectors sign in with OAuth and cannot send a key.
          </li>
          <li>
            Open Settings → Developer → Edit Config — {mono(CLAUDE_DESKTOP_PATHS.mac)} on macOS,
            {' '}{mono(CLAUDE_DESKTOP_PATHS.windows)} on Windows — and add the server. This file holds the key:
            keep it out of backups you share.
            <CodeView className="mt-4" title="claude_desktop_config.json" language="json" code={claudeDesktop(url, apiKey)} wrap />
          </li>
          <li>Quit Claude Desktop completely and start it again. The tools appear under the tools button of a new chat.</li>
        </Steps>
      );
    case 'cursor':
      return (
        <Steps>
          <li>
            Add the server to {mono('~/.cursor/mcp.json')} (yours, for every project) — not a project’s
            {' '}{mono('.cursor/mcp.json')} if it holds a key. Cursor reads {env} from the environment it was started in.
            <CodeView className="mt-4" title="~/.cursor/mcp.json" language="json" code={cursor(url)} wrap />
          </li>
          <li>
            Start Cursor from a terminal where {env} is set ({mono('cursor .')}): an app opened from the Dock or
            the Start menu does not see your shell’s variables.
          </li>
          <li>Check it in Cursor Settings → MCP: {mono(MCP_SERVER_NAME)} shows a green dot and its tools.</li>
        </Steps>
      );
    case 'vscode':
      return (
        <Steps>
          <li>
            Run <em>MCP: Open User Configuration</em> from the Command Palette (or create {mono('.vscode/mcp.json')} in a
            project) and add the server. VS Code asks for the key the first time and keeps it in its secret
            storage — the file holds no key and can be committed.
            <CodeView className="mt-4" title="mcp.json" language="json" code={vscode(url)} wrap />
          </li>
          <li>Start the server from the lens above its entry, paste the key when asked, then use it from Copilot Chat in agent mode.</li>
        </Steps>
      );
    case 'curl':
      return (
        <Steps>
          <li>
            Say hello: the answer names the server and what it offers. Each request stands alone — no session
            to keep.
            <CodeView className="mt-4" title="initialize" language="shell" code={curl.initialize(url)} wrap />
          </li>
          <li>
            List the tools your key may use: only those your permissions cover are listed.
            <CodeView className="mt-4" title="tools/list" language="shell" code={curl.toolsList(url)} wrap />
          </li>
          <li>
            Ask who the key acts as.
            <CodeView className="mt-4" title="tools/call whoami" language="shell" code={curl.whoami(url)} wrap />
          </li>
        </Steps>
      );
  }
}
