import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { getQuota } from '#src/quota';
import { registerNotifications } from '#src/notification';
import { saveChatId } from '#src/telegram';

type Model = NonNullable<ReturnType<ModelRegistry['find']>>;

const models = {
  openrouter: { provider: 'openrouter', id: 'test', baseUrl: 'https://openrouter.ai/api' },
  'openai-codex': { provider: 'openai-codex', id: 'gpt-5.6', baseUrl: 'https://chatgpt.com/backend-api' },
  deepseek: { provider: 'deepseek', id: 'test', baseUrl: 'https://api.deepseek.com' },
  moonshotai: { provider: 'moonshotai', id: 'test', baseUrl: 'https://api.moonshot.ai/v1' },
  'moonshotai-cn': { provider: 'moonshotai-cn', id: 'test', baseUrl: 'https://api.moonshot.cn/v1' },
  zai: { provider: 'zai', id: 'glm-test', baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
  'zai-coding-cn': { provider: 'zai-coding-cn', id: 'glm-test', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' },
  anthropic: { provider: 'anthropic', id: 'claude-test', baseUrl: 'https://api.anthropic.com' },
  xai: { provider: 'xai', id: 'grok-test', baseUrl: 'https://api.x.ai/v1' },
} as unknown as Record<string, Model>;
const registry = { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: 'secret' }), isUsingOAuth: () => false };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test('Telegram quota labels and day units are English while values remain unchanged', async () => {
  const oauth = { ...registry, isUsingOAuth: () => true };
  assert.equal(await getQuota(models.deepseek, registry, async () => json({ balance_infos: [
    { currency: 'USD', total_balance: '12.50' },
  ] })), 'Remaining balance: 12.50 USD');
  assert.equal(await getQuota(models.openrouter, registry, async () => json({ data: {
    total_credits: 10, total_usage: 2,
  } })), 'Remaining credits: 8 USD');
  assert.equal(await getQuota(models.anthropic, oauth, async () => json({
    seven_day: { utilization: 25 },
  })), 'Remaining quota: 7d 75%');
  assert.equal(await getQuota(models.deepseek, registry, async () => json({}, 403)), 'Quota unavailable');
});

test('OpenRouter credits are actual account credits minus usage, not a key limit', async () => {
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/credits');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer secret');
    return json({ data: { total_credits: 100.5, total_usage: 25.75 } });
  };
  assert.equal(await getQuota(models.openrouter, registry, request), 'Remaining credits: 74.75 USD');
});

test('Codex OAuth shows remaining five-hour and weekly subscription quotas', async () => {
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })).toString('base64url');
  const token = `e30.${payload}.signature`;
  const oauth = { ...registry, getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: token }) };
  assert.equal(await getQuota(models['openai-codex'], oauth, async (url, options) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${token}`);
    assert.equal(new Headers(options?.headers).get('ChatGPT-Account-Id'), 'acct-test');
    return json({ plan_type: 'plus', rate_limit: { allowed: true, limit_reached: false,
      primary_window: { used_percent: 23, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 60, limit_window_seconds: 604800 },
    } });
  }), 'Remaining quota: 5h 77%, 7d 40%');
});

test('Codex invalid token, denied endpoint or invalid quota cannot show a percentage', async () => {
  const model = models['openai-codex'];
  const noRequest = async () => { throw new Error('must not send invalid credentials'); };
  assert.equal(await getQuota(model, registry, noRequest), 'Quota unavailable');
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })).toString('base64url');
  const oauth = { ...registry, getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: `e30.${payload}.sig` }) };
  assert.equal(await getQuota(model, oauth, async () => json({}, 401)), 'Quota unavailable');
  assert.equal(await getQuota(model, oauth, async () => json({ rate_limit: {
    primary_window: { used_percent: 130, limit_window_seconds: 18000 },
  } })), 'Quota unavailable');
  assert.equal(await getQuota({ ...model, baseUrl: 'https://proxy.example' }, oauth, noRequest), 'Quota unavailable');
});

test('DeepSeek reports real available balance for each currency without conversion', async () => {
  assert.equal(await getQuota(models.deepseek, registry, async (url) => {
    assert.equal(url, 'https://api.deepseek.com/user/balance');
    return json({ is_available: true, balance_infos: [
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
      { currency: 'USD', total_balance: '2.50', granted_balance: '0.00', topped_up_balance: '2.50' },
    ] });
  }), 'Remaining balance: 110.00 CNY, 2.50 USD');
});

test('Moonshot global and China use their documented currency and endpoint', async () => {
  for (const [provider, currency, host] of [
    ['moonshotai', 'USD', 'https://api.moonshot.ai/v1/users/me/balance'],
    ['moonshotai-cn', 'CNY', 'https://api.moonshot.cn/v1/users/me/balance'],
  ] as const) {
    assert.equal(await getQuota(models[provider], registry, async (url) => {
      assert.equal(url, host);
      return json({ code: 0, data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 }, scode: '0x0', status: true });
    }), `Remaining balance: 49.58894 ${currency}`);
  }
});

test('Z.ai global and China show the remaining coding-plan model quota', async () => {
  for (const [provider, host] of [
    ['zai', 'https://api.z.ai'],
    ['zai-coding-cn', 'https://open.bigmodel.cn'],
  ] as const) {
    assert.equal(await getQuota(models[provider], registry, async (url, options) => {
      assert.equal(url, `${host}/api/monitor/usage/quota/limit`);
      assert.equal(new Headers(options?.headers).get('Authorization'), 'secret');
      return json({ code: 200, msg: 'success', data: { limits: [
        { type: 'TOKENS_LIMIT', percentage: 23, usage: 500, currentValue: 115 },
        { type: 'TIME_LIMIT', percentage: 10, usage: 100, currentValue: 10 },
      ] } });
    }), 'Remaining quota: 5h 77%');
  }
});

test('Anthropic OAuth shows real subscription windows, not API key usage', async () => {
  const oauth = { ...registry, isUsingOAuth: () => true };
  assert.equal(await getQuota(models.anthropic, oauth, async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer secret');
    assert.equal(new Headers(options?.headers).get('anthropic-beta'), 'oauth-2025-04-20');
    return json({ five_hour: { utilization: 24.5, resets_at: '2026-09-28T15:00:00Z' },
      seven_day: { utilization: 60, resets_at: '2026-10-04T12:00:00Z' } });
  }), 'Remaining quota: 5h 75.5%, 7d 40%');
});

test('xAI OAuth reports remaining Grok weekly subscription credits, not prepaid API balance', async () => {
  const oauth = { ...registry, isUsingOAuth: () => true };
  assert.equal(await getQuota(models.xai, oauth, async (url, options) => {
    assert.equal(url, 'https://cli-chat-proxy.grok.com/v1/billing?format=credits');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer secret');
    return json({ config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-09-28T00:00:00Z', end: '2026-10-05T00:00:00Z' },
    creditUsagePercent: 30, productUsage: [{ product: 'GrokBuild', usagePercent: 20 }] } });
  }), 'Remaining quota: 7d 70%');
});

test('xAI missing or empty usage data cannot be treated as 100% remaining', async () => {
  const oauth = { ...registry, isUsingOAuth: () => true };
  for (const productUsage of [undefined, []]) {
    assert.equal(await getQuota(models.xai, oauth, async () => json({ config: {
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-28T00:00:00Z', end: '2026-10-05T00:00:00Z' },
      productUsage,
    } })), 'Quota unavailable');
  }
});

test('new quota endpoints fail closed without the right login or a valid model allowance', async () => {
  const noRequest = async () => { throw new Error('must not send credential'); };
  for (const provider of ['anthropic', 'xai'] as const) {
    assert.equal(await getQuota(models[provider], registry, noRequest), 'Quota unavailable');
  }
  const oauth = { ...registry, isUsingOAuth: () => true };
  assert.equal(await getQuota(models.xai, oauth, async () => json({ config: {
    creditUsagePercent: 25, currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY' },
  } })), 'Quota unavailable');
  assert.equal(await getQuota(models.xai, oauth, async () => json({ config: {
    creditUsagePercent: 101, productUsage: [{ usagePercent: 1 }],
  } })), 'Quota unavailable');
  assert.equal(await getQuota(models.xai, oauth, async () => json({ config: {
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-28T00:00:00Z', end: '2026-10-05T00:00:00Z' },
    productUsage: [{ product: 'GrokBuild', usagePercent: 0 }],
  } })), 'Remaining quota: 7d 100%');
  assert.equal(await getQuota(models.xai, oauth, async () => json({ config: {
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-28T00:00:00Z', end: '2026-10-05T00:00:00Z' },
    productUsage: [{ product: 'GrokBuild', usagePercent: 12 }],
  } })), 'Quota unavailable');
  assert.equal(await getQuota(models.xai, oauth, async () => json({ config: {
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-28T00:00:00Z', end: '2026-10-05T00:00:00Z' },
    productUsage: { usagePercent: 12 },
  } })), 'Quota unavailable');
  assert.equal(await getQuota(models.xai, oauth, async () => json({}, 401)), 'Quota unavailable');
  assert.equal(await getQuota(models.anthropic, oauth, async () => json({ five_hour: { utilization: 110 } })), 'Quota unavailable');
  assert.equal(await getQuota(models.zai, registry, async () => json({ code: 401, data: {
    limits: [{ type: 'TOKENS_LIMIT', percentage: 20 }],
  } })), 'Quota unavailable');
  assert.equal(await getQuota(models.zai, registry, async () => json({ code: 200, data: {
    limits: [{ type: 'TIME_LIMIT', percentage: 20 }],
  } })), 'Quota unavailable');
  assert.equal(await getQuota({ ...models.zai, baseUrl: 'https://proxy.example' }, registry, noRequest), 'Quota unavailable');
});

test('unsupported, proxy-hosted, malformed, unauthorized and missing credentials are unavailable', async () => {
  const noRequest = async () => { throw new Error('must not send provider credential'); };
  assert.equal(await getQuota({ ...models.openrouter, provider: 'custom', baseUrl: 'https://custom.test' }, registry, noRequest), 'Quota unavailable');
  assert.equal(await getQuota({ ...models.openrouter, baseUrl: 'https://proxy.example/api' }, registry, noRequest), 'Quota unavailable');
  assert.equal(await getQuota(models.openrouter, { ...registry, getApiKeyAndHeaders: async () => ({ ok: false as const, error: 'secret' }) }, noRequest), 'Quota unavailable');
  for (const response of [json({}, 403), json({ data: { total_credits: '100', total_usage: 1 } }), json({ data: { total_credits: -1, total_usage: 0 } })]) {
    assert.equal(await getQuota(models.openrouter, registry, async () => response), 'Quota unavailable');
  }
  assert.equal(await getQuota(models.deepseek, registry, async () => json({ balance_infos: [{ currency: 'USD', total_balance: 'NaN' }] })), 'Quota unavailable');
  assert.equal(await getQuota(models.moonshotai, registry, async () => { throw new Error('secret'); }), 'Quota unavailable');
});

test('provider lookup failure cannot suppress Telegram delivery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'quota-notifier-'));
  try {
    saveChatId(dir, 987);
    const handlers = new Map<string, (event: unknown, ctx: unknown) => void | Promise<void>>();
    const sent: string[] = [];
    registerNotifications({ on: (name: string, handler: (event: unknown, ctx: unknown) => void | Promise<void>) => {
      handlers.set(name, handler);
    } } as unknown as ExtensionAPI, dir, 'bot-secret', async (url, options) => {
      if (String(url).includes('credits')) return json({}, 403);
      sent.push(JSON.parse(String(options?.body)).text);
      return json({ ok: true, result: { message_id: 1 } });
    });
    const entries: Array<{ type: string; id: string; message: unknown }> = [{ type: 'message', id: 'user', message: { role: 'user', content: 'question' } }];
    const ctx = {
      sessionManager: { getLeafId: () => 'user', getBranch: () => entries },
      modelRegistry: { find: () => models.openrouter, ...registry },
      hasUI: false,
    };
    await handlers.get('agent_start')!({}, ctx);
    entries.push({ type: 'message', id: 'answer', message: { role: 'assistant', stopReason: 'stop', provider: 'openrouter', model: 'test', content: [{ type: 'text', text: 'final answer' }] } });
    await handlers.get('agent_settled')!({}, ctx);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /final answer/);
    assert.match(sent[0], /Quota unavailable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
