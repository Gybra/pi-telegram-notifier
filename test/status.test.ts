import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { saveChatId } from '#src/telegram';

test('telegram-status reports token and local pairing without exposing the chat ID', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'telegram-status-'));
  const originalDir = process.env.PI_CODING_AGENT_DIR;
  const originalToken = process.env.PI_TELEGRAM_BOT_TOKEN;
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
    assert.match(notices[0], /Bot token: not configured/);
    assert.match(notices[0], /Private chat: not paired/);
    assert.match(notices[0], /Live connectivity: not checked/);
    assert.match(notices[0], /telegram-pair/);

    notices.length = 0;
    process.env.PI_TELEGRAM_BOT_TOKEN = 'test-token';
    saveChatId(dir, 987);
    extension(pi);
    await commands.get('telegram-status')?.('', ctx);
    assert.match(notices[0], /Bot token: configured/);
    assert.match(notices[0], /Private chat: paired/);
    assert.match(notices[0], /Live connectivity: not checked/);
    assert.doesNotMatch(notices[0], /987/);
  } finally {
    if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalDir;
    if (originalToken === undefined) delete process.env.PI_TELEGRAM_BOT_TOKEN;
    else process.env.PI_TELEGRAM_BOT_TOKEN = originalToken;
    rmSync(dir, { recursive: true, force: true });
  }
});
