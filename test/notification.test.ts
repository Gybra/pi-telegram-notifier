import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent';
import { finalResponse, formatNotification, registerNotifications } from '#src/notification';
import { saveChatId } from '#src/telegram';

const message = (id: string, role: string, content: unknown, stopReason = 'stop') => ({
  type: 'message', id, message: { role, content, stopReason, provider: 'openrouter', model: 'model-v1' },
}) as unknown as SessionEntry;
const assistant = (id: string, text: string, reason = 'stop') => message(id, 'assistant', [{ type: 'text', text }], reason);

function runtime(entries: SessionEntry[], mode = 'tui', transport?: typeof fetch) {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => void | Promise<void>>();
  const notices: string[] = [];
  const sent: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'telegram-notifier-'));
  saveChatId(dir, 987);
  const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => void | Promise<void>) => {
    handlers.set(name, handler);
  } } as unknown as ExtensionAPI;
  const ctx = {
    mode, hasUI: mode === 'tui', modelRegistry: undefined as undefined | { find: () => never },
    sessionManager: { getLeafId: () => entries.at(-1)?.id ?? null, getBranch: () => entries },
    ui: { notify: (text: string) => notices.push(text) },
  };
  const fetchImpl: typeof fetch = async (_url, options) => {
    sent.push(JSON.parse(String(options?.body)).text);
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  registerNotifications(pi, dir, 'secret', transport ?? fetchImpl);
  return { handlers, ctx, entries, notices, sent, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('only the final completed response since agent_start is sent once', async () => {
  const state = runtime([message('old', 'user', 'prompt')]);
  try {
    await state.handlers.get('agent_start')!({}, state.ctx);
    state.entries.push(assistant('tools', '', 'toolUse'), message('result', 'toolResult', 'done'));
    assert.equal(state.sent.length, 0);
    state.entries.push(assistant('last', 'full answer'));
    await state.handlers.get('agent_settled')!({}, state.ctx);
    assert.equal(state.sent.length, 1);
    assert.match(state.sent[0], /full answer/);
    assert.match(state.sent[0], /openrouter/);
    assert.ok(state.sent[0].includes(`Device: ${hostname()}\n`));
    assert.match(state.sent[0], /Quota unavailable/);
    assert.match(state.sent[0], /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/);
  } finally { state.cleanup(); }
});

test('first response in an empty Pi session is delivered', async () => {
  const state = runtime([]);
  state.ctx.sessionManager.getLeafId = () => null;
  try {
    await state.handlers.get('agent_start')!({}, state.ctx);
    state.entries.push(message('user', 'user', 'question'), assistant('reply', 'first answer'));
    await state.handlers.get('agent_settled')!({}, state.ctx);
    assert.equal(state.sent.length, 1);
    assert.match(state.sent[0], /first answer/);
  } finally { state.cleanup(); }
});

test('no stale answer is sent on failure or missing response', async () => {
  const state = runtime([assistant('old', 'old answer'), message('user', 'user', 'new prompt')]);
  try {
    await state.handlers.get('agent_start')!({}, state.ctx);
    await state.handlers.get('agent_settled')!({}, state.ctx);
    state.entries.push(assistant('bad', 'partial', 'error'));
    await state.handlers.get('agent_settled')!({}, state.ctx);
    assert.deepEqual(state.sent, []);
    assert.equal(finalResponse(state.entries, 'user'), undefined);
  } finally { state.cleanup(); }
});

test('format includes full text including multiple text blocks and provider', () => {
  const branch = [message('base', 'user', 'ask'), message('thought', 'assistant', [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Ciao' }, { type: 'text', text: ' mondo' }])];
  const response = finalResponse(branch, 'base');
  assert.deepEqual(response, { text: 'Ciao mondo', provider: 'openrouter', modelId: 'model-v1' });
  assert.ok(response);
  assert.equal(formatNotification('2026-09-28T00:00:00.000Z', response, 'Quota unavailable'),
    `2026-09-28T00:00:00.000Z\nDevice: ${hostname()}\nProvider: openrouter\nQuota unavailable\n\nCiao mondo`);
});

test('delivery errors notify in TUI but never throw or leak credentials', async () => {
  const state = runtime([message('user', 'user', 'ask')], 'tui', async () => { throw new Error('secret'); });
  try {
    await state.handlers.get('agent_start')!({}, state.ctx);
    state.entries.push(assistant('reply', 'some text'));
    await state.handlers.get('agent_settled')!({}, state.ctx);
    assert.equal(state.notices.length, 1);
    assert.match(state.notices[0], /Telegram delivery/);
    assert.doesNotMatch(state.notices[0], /secret/);
  } finally { state.cleanup(); }
});

test('model lookup failure does not suppress the final notification', async () => {
  const state = runtime([message('user', 'user', 'ask')]);
  state.ctx.modelRegistry = { find: () => { throw new Error('registry unavailable'); } };
  try {
    await state.handlers.get('agent_start')!({}, state.ctx);
    state.entries.push(assistant('reply', 'answer despite lookup failure'));
    await state.handlers.get('agent_settled')!({}, state.ctx);
    assert.equal(state.sent.length, 1);
    assert.match(state.sent[0], /answer despite lookup failure/);
    assert.match(state.sent[0], /Quota unavailable/);
    assert.deepEqual(state.notices, []);
  } finally { state.cleanup(); }
});

test('non-interactive print mode still sends the response', async () => {
  const state = runtime([message('user', 'user', 'ask')], 'print');
  try {
    await state.handlers.get('agent_start')!({}, state.ctx);
    state.entries.push(assistant('reply', 'from print mode'));
    await state.handlers.get('agent_settled')!({}, state.ctx);
    assert.match(state.sent[0], /from print mode/);
  } finally { state.cleanup(); }
});
