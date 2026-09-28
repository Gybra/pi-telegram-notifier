import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pairChat, loadChatId, saveChatId, sendTelegram } from '#src/telegram';

const reply = (result: unknown, status = 200) => new Response(JSON.stringify({ ok: status < 400, result }), { status });

test('pairs only a matching private /start and ignores wrong/group messages', async () => {
  const calls: Parameters<typeof fetch>[0][] = [];
  const fetchImpl: typeof fetch = async (url) => {
    calls.push(url);
    return reply([
      { update_id: 10, message: { text: '/start wrong', chat: { id: 1, type: 'private' } } },
      { update_id: 11, message: { text: '/start abc', chat: { id: -2, type: 'group' } } },
      { update_id: 12, message: { text: '/start abc', chat: { id: 987, type: 'private' } } },
    ]);
  };
  assert.equal(await pairChat('token-secret', 'abc', fetchImpl), 987);
  assert.equal(calls.length, 1);
});

test('expired code cannot pair, even when matching update arrives too late', async () => {
  let tick = 0;
  await assert.rejects(pairChat('token', 'abc', async () => reply([]), () => (tick++ ? 300001 : 0)), /expir/i);
  const times = [0, 0, 300001];
  await assert.rejects(pairChat('token', 'abc', async () => reply([
    { update_id: 1, message: { text: '/start abc', chat: { id: 987, type: 'private' } } },
  ]), () => times.shift() ?? 300001), /expir/i);
});

test('conflicting webhook/getUpdates consumer does not bind a chat or expose token', async () => {
  await assert.rejects(pairChat('secret', 'abc', async () => reply(null, 409)), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /webhook|another.*consumer/i);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test('chat ID is saved privately and reloaded from user directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'telegram-'));
  try {
    assert.equal(loadChatId(dir), undefined);
    saveChatId(dir, 987);
    assert.equal(loadChatId(dir), 987);
    const file = join(dir, 'pi-telegram-notifier.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { chatId: 987 });
    assert.throws(() => saveChatId(dir, '987' as unknown as number));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('long Unicode response is delivered intact in Telegram-sized chunks', async () => {
  const sent: string[] = [];
  const text = '😀'.repeat(3000) + 'finish';
  await sendTelegram('secret', 987, text, async (_url, options) => {
    sent.push(JSON.parse(String(options?.body)).text);
    return reply({ message_id: sent.length });
  });
  assert.ok(sent.length > 1);
  assert.ok(sent.every((part) => part.length <= 4096));
  assert.equal(sent.join(''), text);
});

test('Telegram errors never expose the bot token or response body', async () => {
  await assert.rejects(sendTelegram('secret', 987, 'hello', async () =>
    new Response(JSON.stringify({ description: 'secret' }), { status: 401 })), (error) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /secret/);
    assert.match(error.message, /Telegram/);
    return true;
  });
});
