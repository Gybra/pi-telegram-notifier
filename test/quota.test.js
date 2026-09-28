import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getQuota } from '../src/quota.js';
import { registerNotifications } from '../src/notification.js';
import { saveChatId } from '../src/telegram.js';

const models = {
  openrouter: { provider: 'openrouter', id: 'test', baseUrl: 'https://openrouter.ai/api' },
  'openai-codex': { provider: 'openai-codex', id: 'gpt-5.6', baseUrl: 'https://chatgpt.com/backend-api' },
  deepseek: { provider: 'deepseek', id: 'test', baseUrl: 'https://api.deepseek.com' },
  moonshotai: { provider: 'moonshotai', id: 'test', baseUrl: 'https://api.moonshot.ai/v1' },
  'moonshotai-cn': { provider: 'moonshotai-cn', id: 'test', baseUrl: 'https://api.moonshot.cn/v1' },
};
const registry = { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'secret' }) };
const json = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });

test('OpenRouter credits are actual account credits minus usage, not a key limit', async () => {
  const request = async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/credits');
    assert.equal(options.headers.Authorization, 'Bearer secret');
    return json({ data: { total_credits: 100.5, total_usage: 25.75 } });
  };
  assert.equal(await getQuota(models.openrouter, registry, request), 'Crediti residui: 74.75 USD');
});

test('Codex OAuth shows remaining five-hour and weekly subscription quotas', async () => {
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })).toString('base64url');
  const token = `e30.${payload}.signature`;
  const oauth = { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: token }) };
  assert.equal(await getQuota(models['openai-codex'], oauth, async (url, options) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.headers['ChatGPT-Account-Id'], 'acct-test');
    return json({ plan_type: 'plus', rate_limit: { allowed: true, limit_reached: false,
      primary_window: { used_percent: 23, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 60, limit_window_seconds: 604800 },
    } });
  }), 'Quota residua: 5h 77%, 7g 40%');
});

test('Codex invalid token, denied endpoint or invalid quota cannot show a percentage', async () => {
  const model = models['openai-codex'];
  const noRequest = async () => { throw new Error('must not send invalid credentials'); };
  assert.equal(await getQuota(model, registry, noRequest), 'Quota non disponibile');
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })).toString('base64url');
  const oauth = { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: `e30.${payload}.sig` }) };
  assert.equal(await getQuota(model, oauth, async () => json({}, 401)), 'Quota non disponibile');
  assert.equal(await getQuota(model, oauth, async () => json({ rate_limit: {
    primary_window: { used_percent: 130, limit_window_seconds: 18000 },
  } })), 'Quota non disponibile');
  assert.equal(await getQuota({ ...model, baseUrl: 'https://proxy.example' }, oauth, noRequest), 'Quota non disponibile');
});

test('DeepSeek reports real available balance for each currency without conversion', async () => {
  assert.equal(await getQuota(models.deepseek, registry, async (url) => {
    assert.equal(url, 'https://api.deepseek.com/user/balance');
    return json({ is_available: true, balance_infos: [
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
      { currency: 'USD', total_balance: '2.50', granted_balance: '0.00', topped_up_balance: '2.50' },
    ] });
  }), 'Saldo residuo: 110.00 CNY, 2.50 USD');
});

test('Moonshot global and China use their documented currency and endpoint', async () => {
  for (const [provider, currency, host] of [
    ['moonshotai', 'USD', 'https://api.moonshot.ai/v1/users/me/balance'],
    ['moonshotai-cn', 'CNY', 'https://api.moonshot.cn/v1/users/me/balance'],
  ]) {
    assert.equal(await getQuota(models[provider], registry, async (url) => {
      assert.equal(url, host);
      return json({ code: 0, data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 }, scode: '0x0', status: true });
    }), `Saldo residuo: 49.58894 ${currency}`);
  }
});

test('unsupported, proxy-hosted, malformed, unauthorized and missing credentials are unavailable', async () => {
  const noRequest = async () => { throw new Error('must not send provider credential'); };
  assert.equal(await getQuota({ provider: 'custom', baseUrl: 'https://custom.test' }, registry, noRequest), 'Quota non disponibile');
  assert.equal(await getQuota({ ...models.openrouter, baseUrl: 'https://proxy.example/api' }, registry, noRequest), 'Quota non disponibile');
  assert.equal(await getQuota(models.openrouter, { getApiKeyAndHeaders: async () => ({ ok: false, error: 'secret' }) }, noRequest), 'Quota non disponibile');
  for (const response of [json({}, 403), json({ data: { total_credits: '100', total_usage: 1 } }), json({ data: { total_credits: -1, total_usage: 0 } })]) {
    assert.equal(await getQuota(models.openrouter, registry, async () => response), 'Quota non disponibile');
  }
  assert.equal(await getQuota(models.deepseek, registry, async () => json({ balance_infos: [{ currency: 'USD', total_balance: 'NaN' }] })), 'Quota non disponibile');
  assert.equal(await getQuota(models.moonshotai, registry, async () => { throw new Error('secret'); }), 'Quota non disponibile');
});

test('provider lookup failure cannot suppress Telegram delivery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'quota-notifier-'));
  try {
    saveChatId(dir, 987);
    const handlers = new Map();
    const sent = [];
    registerNotifications({ on: (name, handler) => handlers.set(name, handler) }, dir, 'bot-secret', async (url, options) => {
      if (url.includes('credits')) return json({}, 403);
      sent.push(JSON.parse(options.body).text);
      return json({ ok: true, result: { message_id: 1 } });
    });
    const entries = [{ type: 'message', id: 'user', message: { role: 'user', content: 'question' } }];
    const ctx = {
      sessionManager: { getLeafId: () => 'user', getBranch: () => entries },
      modelRegistry: { find: () => models.openrouter, ...registry },
      hasUI: false,
    };
    await handlers.get('agent_start')({}, ctx);
    entries.push({ type: 'message', id: 'answer', message: { role: 'assistant', stopReason: 'stop', provider: 'openrouter', model: 'test', content: [{ type: 'text', text: 'final answer' }] } });
    await handlers.get('agent_settled')({}, ctx);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /final answer/);
    assert.match(sent[0], /Quota non disponibile/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
