import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { saveChatId } from '#src/telegram';

test('Telegram commands show status and pairing steps with clear spacing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'telegram-status-'));
  const originalDir = process.env.PI_CODING_AGENT_DIR;
  const originalToken = process.env.PI_TELEGRAM_BOT_TOKEN;
  const originalFetch = globalThis.fetch;
  type Context = { ui: { notify: (text: string, level: string) => void } };
  const commands = new Map<string, (args: string, ctx: Context) => Promise<void>>();
  const notices: string[] = [];
  const pi = {
    on: () => {},
    registerCommand: (name: string, command: { handler: (args: string, ctx: Context) => Promise<void> }) => commands.set(name, command.handler),
  } as unknown as ExtensionAPI;
  const ctx = { ui: { notify: (text: string) => notices.push(text) } };

  try {
    const { default: extension } = await import(new URL('../extensions/index.ts', import.meta.url).href);
    process.env.PI_CODING_AGENT_DIR = dir;
    delete process.env.PI_TELEGRAM_BOT_TOKEN;
    extension(pi);
    await commands.get('telegram-status')?.('', ctx);
    assert.equal(notices[0], [
      'Telegram connection',
      '',
      'Configuration',
      'Bot token: Not configured',
      'Private chat: Not paired',
      '',
      'Connectivity',
      'Live check: Not performed',
      '',
      'Next steps',
      'Set PI_TELEGRAM_BOT_TOKEN and restart Pi.',
      'Run /telegram-pair to pair a private chat.',
    ].join('\n'));

    notices.length = 0;
    process.env.PI_TELEGRAM_BOT_TOKEN = 'test-token';
    saveChatId(dir, 987);
    extension(pi);
    await commands.get('telegram-status')?.('', ctx);
    assert.equal(notices[0], [
      'Telegram connection',
      '',
      'Configuration',
      'Bot token: Configured',
      'Private chat: Paired',
      '',
      'Connectivity',
      'Live check: Not performed',
    ].join('\n'));
    assert.doesNotMatch(notices[0], /987/);

    notices.length = 0;
    globalThis.fetch = async () => {
      const code = notices[0].match(/\/start ([a-f0-9]{32})/)?.[1];
      return new Response(JSON.stringify({ ok: true, result: [{
        update_id: 1,
        message: { text: `/start ${code}`, chat: { id: 987, type: 'private' } },
      }] }));
    };
    await commands.get('telegram-pair')?.('', ctx);
    assert.match(notices[0], /^Pair Telegram\n\nIn your private chat with the bot, send:\n\n\/start [a-f0-9]{32}\n\nCode expires in 5 minutes\.$/);
    assert.equal(notices[1], 'Telegram paired\n\nPrivate chat linked successfully.');
  } finally {
    if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalDir;
    if (originalToken === undefined) delete process.env.PI_TELEGRAM_BOT_TOKEN;
    else process.env.PI_TELEGRAM_BOT_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
