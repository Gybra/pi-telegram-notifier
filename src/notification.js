import { loadChatId, sendTelegram } from './telegram.js';
import { getQuota } from './quota.js';

export function finalResponse(branch, startLeafId) {
  const index = branch.findIndex((entry) => entry.id === startLeafId);
  if (index < 0) return undefined;
  const latest = branch.slice(index + 1).filter((entry) => entry.type === 'message').at(-1)?.message;
  if (latest?.role !== 'assistant' || !['stop', 'length'].includes(latest.stopReason)) return undefined;
  const text = latest.content.filter((item) => item.type === 'text').map((item) => item.text).join('');
  if (!text) return undefined;
  return { text, provider: latest.provider, modelId: latest.model };
}

export function formatNotification(timestamp, response, quota) {
  return `${timestamp}\nProvider: ${response.provider}\n${quota}\n\n${response.text}`;
}

export function registerNotifications(pi, agentDir, token, fetchImpl = fetch) {
  let startLeafId;
  pi.on('agent_start', (_event, ctx) => {
    startLeafId = ctx.sessionManager.getLeafId();
  });
  pi.on('agent_settled', async (_event, ctx) => {
    if (!token || startLeafId === undefined) return;
    const response = finalResponse(ctx.sessionManager.getBranch(), startLeafId);
    startLeafId = undefined;
    const chatId = loadChatId(agentDir);
    if (!chatId || !response) return;
    try {
      const model = ctx.modelRegistry?.find(response.provider, response.modelId);
      const quota = await getQuota(model, ctx.modelRegistry, fetchImpl);
      await sendTelegram(token, chatId,
        formatNotification(new Date().toISOString(), response, quota), fetchImpl);
    } catch {
      if (ctx.hasUI) ctx.ui.notify('Telegram delivery failed; check the bot connection', 'error');
      else console.error('Telegram delivery failed; check the bot connection');
    }
  });
}
