const UNAVAILABLE = 'Quota non disponibile';

const providers = {
  openrouter: ['https://openrouter.ai', 'https://openrouter.ai/api/v1/credits'],
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
    if (!auth.ok || !auth.apiKey) return UNAVAILABLE;
    const response = await fetchImpl(provider[1], {
      headers: { Authorization: `Bearer ${auth.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return UNAVAILABLE;
    const data = await response.json();
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
