const UNAVAILABLE = 'Quota non disponibile';

const providers = {
  openrouter: ['https://openrouter.ai', 'https://openrouter.ai/api/v1/credits'],
  'openai-codex': ['https://chatgpt.com', 'https://chatgpt.com/backend-api/wham/usage'],
  deepseek: ['https://api.deepseek.com', 'https://api.deepseek.com/user/balance'],
  moonshotai: ['https://api.moonshot.ai', 'https://api.moonshot.ai/v1/users/me/balance'],
  'moonshotai-cn': ['https://api.moonshot.cn', 'https://api.moonshot.cn/v1/users/me/balance'],
};

export async function getQuota(model, modelRegistry, fetchImpl = fetch) {
  const provider = model && providers[model.provider];
  if (!provider) return UNAVAILABLE;
  try {
    if (new URL(model.baseUrl).origin !== provider[0]) return UNAVAILABLE;
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey || (auth.baseUrl && new URL(auth.baseUrl).origin !== provider[0])) return UNAVAILABLE;
    const headers = { Authorization: `Bearer ${auth.apiKey}` };
    if (model.provider === 'openai-codex') {
      const payload = JSON.parse(Buffer.from(auth.apiKey.split('.')[1], 'base64url').toString('utf8'));
      const accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id;
      if (typeof accountId !== 'string' || !accountId) return UNAVAILABLE;
      headers['ChatGPT-Account-Id'] = accountId;
    }
    const response = await fetchImpl(provider[1], {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return UNAVAILABLE;
    const data = await response.json();
    if (model.provider === 'openai-codex') {
      const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].filter(Boolean);
      if (!windows.length) return UNAVAILABLE;
      const remaining = windows.map(({ used_percent: used, limit_window_seconds: seconds }) => {
        if (!Number.isFinite(used) || used < 0 || used > 100 || !Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
        const period = seconds % 86400 === 0 ? `${seconds / 86400}g` : seconds % 3600 === 0 ? `${seconds / 3600}h` : `${seconds / 60}m`;
        return `${period} ${100 - used}%`;
      });
      return remaining.every(Boolean) ? `Quota residua: ${remaining.join(', ')}` : UNAVAILABLE;
    }
    if (model.provider === 'openrouter') {
      const total = data.data?.total_credits;
      const used = data.data?.total_usage;
      if (typeof total !== 'number' || typeof used !== 'number' ||
          !Number.isFinite(total) || !Number.isFinite(used) || total < 0 || used < 0 || used > total) return UNAVAILABLE;
      return `Crediti residui: ${(total - used).toFixed(6).replace(/\.?0+$/, '')} USD`;
    }
    if (model.provider === 'deepseek') {
      if (!Array.isArray(data.balance_infos) || !data.balance_infos.length) return UNAVAILABLE;
      const balances = data.balance_infos.map(({ currency, total_balance }) => {
        if (!['CNY', 'USD'].includes(currency) || typeof total_balance !== 'string' ||
            !/^\d+(?:\.\d+)?$/.test(total_balance)) return undefined;
        return `${total_balance} ${currency}`;
      });
      return balances.every(Boolean) ? `Saldo residuo: ${balances.join(', ')}` : UNAVAILABLE;
    }
    const amount = data.data?.available_balance;
    if (data.status !== true || data.code !== 0 || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return UNAVAILABLE;
    return `Saldo residuo: ${amount} ${model.provider === 'moonshotai-cn' ? 'CNY' : 'USD'}`;
  } catch {
    return UNAVAILABLE;
  }
}
