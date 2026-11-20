import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// 只在本地模拟模型回复。Claude Code 的 MCP 握手、工具调用和结果回传由真实 CLI 执行。
export async function claudeRead(exe: string, api: string, run: string, auth: string, ticket: string, useSkill = false) {
  const cwd = await mkdtemp(join(tmpdir(), 'ticket-claude-'));
  const config = join(cwd, 'config'); await mkdir(config);
  const name = 'mcp__ticket__ticket_summary';
  let returned = false, toolOffered = false, skillSeen = false;
  const model = createServer(async (req, res) => {
    if (!req.url?.startsWith('/v1/messages')) { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (useSkill && JSON.stringify(input.messages).includes('当前运行与用户身份由启动配置绑定')) skillSeen = true;
    const offered = Array.isArray(input.tools) && input.tools.some((tool: { name: string }) => tool.name === name);
    toolOffered ||= offered;
    const blocks = (input.messages ?? []).flatMap((m: { content: unknown }) => Array.isArray(m.content) ? m.content : []);
    const got = blocks.some((b: { type: string; content?: unknown }) => b.type === 'tool_result' && JSON.stringify(b.content).includes(ticket));
    returned ||= got;
    const call = offered && !blocks.some((b: { type: string }) => b.type === 'tool_result');
    const content = call ? { type: 'tool_use', id: 'toolu_ticket', name, input: {} } : { type: 'text', text: got ? '摘要已核实' : '完成' };
    const message = { id: 'msg_ticket', type: 'message', role: 'assistant', model: input.model,
      content: [content], stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 4 } };
    if (!input.stream) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type: string, args: object) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...args }) + '\n\n');
    event('message_start', { message: { ...message, content: [], stop_reason: null } });
    event('content_block_start', { index: 0, content_block: call ? content : { type: 'text', text: '' } });
    if (!call) event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: content.text } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 4 } });
    event('message_stop', {}); res.end();
  });
  await new Promise<void>(ok => model.listen(0, '127.0.0.1', ok));
  try {
    const local = 'http://127.0.0.1:' + (model.address() as AddressInfo).port;
    const projectRoot = resolve('../..');
    if (useSkill) {
      const skillPath = '.claude/skills/ticket-summary';
      await mkdir(join(cwd, skillPath), { recursive: true });
      await copyFile(join(projectRoot, skillPath, 'SKILL.md'), join(cwd, skillPath, 'SKILL.md'));
    }
    const project = JSON.parse(await readFile(join(projectRoot, '.mcp.json'), 'utf8'));
    const ticketServer = project.mcpServers.ticket;
    ticketServer.command = process.execPath;
    ticketServer.args = ticketServer.args.map((arg: string) => resolve(projectRoot, arg));
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) env[key] = process.env[key];
    const child = spawn(exe, ['--bare', ...(useSkill ? ['--setting-sources', 'project', '--add-dir', cwd] : []), '--print', '--no-session-persistence', '--strict-mcp-config',
      '--mcp-config', JSON.stringify(project), '--model', 'claude-sonnet-4-6', '--tools', '',
      '--allowedTools', name, '--', useSkill ? '/ticket-summary' : '请用工单摘要工具核对当前工单。'], {
      cwd, env: { ...env, HOME: cwd, USERPROFILE: cwd, CLAUDE_CONFIG_DIR: config, TICKET_API_AUTH: auth, TICKET_API_ORIGIN: api, TICKET_RUN_ID: run,
        ANTHROPIC_API_KEY: 'local-fixture', ANTHROPIC_BASE_URL: local, ENABLE_TOOL_SEARCH: 'false',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 35_000);
    try {
      const exitCode = await new Promise<number | null>((ok, fail) => { child.once('error', fail); child.once('close', ok); });
      return { exitCode, toolOffered, returned, ...(useSkill ? { skillSeen } : {}) };
    } finally { clearTimeout(timer); }
  } finally {
    await new Promise<void>(ok => model.close(() => ok()));
    if (dirname(resolve(cwd)) === resolve(tmpdir())) await rm(cwd, { recursive: true, force: true });
  }
}
