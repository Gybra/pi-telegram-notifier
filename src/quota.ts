import type { ModelRegistry } from '@earendil-works/pi-coding-agent';

const UNAVAILABLE = 'Quota unavailable';

type Model = NonNullable<ReturnType<ModelRegistry['find']>>;

const providers: Record<string, { origin: string; url: string }> = {
  openrouter: { origin: 'https://openrouter.ai', url: 'https://openrouter.ai/api/v1/credits' },
  'openai-codex': { origin: 'https://chatgpt.com', url: 'https://chatgpt.com/backend-api/wham/usage' },
  deepseek: { origin: 'https://api.deepseek.com', url: 'https://api.deepseek.com/user/balance' },
  moonshotai: { origin: 'https://api.moonshot.ai', url: 'https://api.moonshot.ai/v1/users/me/balance' },
  'moonshotai-cn': { origin: 'https://api.moonshot.cn', url: 'https://api.moonshot.cn/v1/users/me/balance' },
  zai: { origin: 'https://api.z.ai', url: 'https://api.z.ai/api/monitor/usage/quota/limit' },
  'zai-coding-cn': { origin: 'https://open.bigmodel.cn', url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit' },
  anthropic: { origin: 'https://api.anthropic.com', url: 'https://api.anthropic.com/api/oauth/usage' },
  xai: { origin: 'https://api.x.ai', url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits' },
};

function remainingPercent(used: unknown): number | undefined {
  return typeof used === 'number' && Number.isFinite(used) && used >= 0 && used <= 100 ? 100 - used : undefined;
}

export async function getQuota(model: Model | undefined, modelRegistry: Pick<ModelRegistry, 'getApiKeyAndHeaders' | 'isUsingOAuth'> | undefined, fetchImpl: typeof fetch = fetch): Promise<string> {
  const provider = model && providers[model.provider];
  if (!provider) return UNAVAILABLE;
  try {
    if (new URL(model.baseUrl).origin !== provider.origin) return UNAVAILABLE;
    if (['anthropic', 'xai'].includes(model.provider) && !modelRegistry?.isUsingOAuth(model)) return UNAVAILABLE;
    const auth = await modelRegistry?.getApiKeyAndHeaders(model);
    if (!auth?.ok || !auth.apiKey || (auth.baseUrl && new URL(auth.baseUrl).origin !== provider.origin)) return UNAVAILABLE;
    const headers: Record<string, string> = { Authorization: ['zai', 'zai-coding-cn'].includes(model.provider) ? auth.apiKey : `Bearer ${auth.apiKey}` };
    if (model.provider === 'anthropic') {
      headers['anthropic-beta'] = 'oauth-2025-04-20';
      headers['anthropic-version'] = '2023-06-01';
    }
    if (model.provider === 'openai-codex') {
      const payload = JSON.parse(Buffer.from(auth.apiKey.split('.')[1], 'base64url').toString('utf8'));
      const accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id;
      if (typeof accountId !== 'string' || !accountId) return UNAVAILABLE;
      headers['ChatGPT-Account-Id'] = accountId;
    }
    const response = await fetchImpl(provider.url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return UNAVAILABLE;
    const data = await response.json();
    if (['zai', 'zai-coding-cn'].includes(model.provider)) {
      if (data.success === false || ![undefined, 0, 200].includes(data.code)) return UNAVAILABLE;
      const used = data.data?.limits?.find((limit: { type: string; percentage: number }) => limit.type === 'TOKENS_LIMIT')?.percentage;
      const remaining = remainingPercent(used);
      return remaining === undefined ? UNAVAILABLE : `Remaining quota: 5h ${remaining}%`;
    }
    if (model.provider === 'anthropic') {
      const windows = [['five_hour', '5h'], ['seven_day', '7d']]
        .map(([key, label]) => {
          const remaining = remainingPercent(data[key]?.utilization);
          return remaining === undefined ? undefined : `${label} ${remaining}%`;
        }).filter(Boolean);
      return windows.length ? `Remaining quota: ${windows.join(', ')}` : UNAVAILABLE;
    }
    if (model.provider === 'xai') {
      const config = data.config;
      if (config?.currentPeriod?.type !== 'USAGE_PERIOD_TYPE_WEEKLY') return UNAVAILABLE;
      let remaining = remainingPercent(config.creditUsagePercent);
      if (remaining === undefined && config.creditUsagePercent === undefined) {
        const { currentPeriod, productUsage } = config;
        if (Date.parse(currentPeriod.start) < Date.parse(currentPeriod.end) &&
            Array.isArray(productUsage) && productUsage.length > 0 && productUsage.every((item) => item?.usagePercent === 0)) remaining = 100;
      }
      return remaining === undefined ? UNAVAILABLE : `Remaining quota: 7d ${remaining}%`;
    }
    if (model.provider === 'openai-codex') {
      const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].filter(Boolean);
      if (!windows.length) return UNAVAILABLE;
      const remaining = windows.map(({ used_percent: used, limit_window_seconds: seconds }) => {
        if (!Number.isFinite(used) || used < 0 || used > 100 || !Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
        const period = seconds % 86400 === 0 ? `${seconds / 86400}d` : seconds % 3600 === 0 ? `${seconds / 3600}h` : `${seconds / 60}m`;
        return `${period} ${100 - used}%`;
      });
      return remaining.every(Boolean) ? `Remaining quota: ${remaining.join(', ')}` : UNAVAILABLE;
    }
    if (model.provider === 'openrouter') {
      const total = data.data?.total_credits;
      const used = data.data?.total_usage;
      if (typeof total !== 'number' || typeof used !== 'number' ||
          !Number.isFinite(total) || !Number.isFinite(used) || total < 0 || used < 0 || used > total) return UNAVAILABLE;
      return `Remaining credits: ${(total - used).toFixed(6).replace(/\.?0+$/, '')} USD`;
    }
    if (model.provider === 'deepseek') {
      if (!Array.isArray(data.balance_infos) || !data.balance_infos.length) return UNAVAILABLE;
      const balances = data.balance_infos.map(({ currency, total_balance }: { currency: string; total_balance: string }) => {
        if (!['CNY', 'USD'].includes(currency) || typeof total_balance !== 'string' ||
            !/^\d+(?:\.\d+)?$/.test(total_balance)) return undefined;
        return `${total_balance} ${currency}`;
      });
      return balances.every(Boolean) ? `Remaining balance: ${balances.join(', ')}` : UNAVAILABLE;
    }
    const amount = data.data?.available_balance;
    if (data.status !== true || data.code !== 0 || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return UNAVAILABLE;
    return `Remaining balance: ${amount} ${model.provider === 'moonshotai-cn' ? 'CNY' : 'USD'}`;
  } catch {
    return UNAVAILABLE;
  }
}
