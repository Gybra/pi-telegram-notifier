import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadChatId, pairChat, saveChatId } from '#src/telegram';
import { registerNotifications } from '#src/notification';

const agentDir = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');

export default function (pi: ExtensionAPI) {
  registerNotifications(pi, agentDir(), process.env.PI_TELEGRAM_BOT_TOKEN);
  pi.registerCommand('telegram-status', {
    description: 'Show the Telegram bot configuration and pairing status',
    handler: async (_args, ctx) => {
      const tokenConfigured = !!process.env.PI_TELEGRAM_BOT_TOKEN;
      const paired = loadChatId(agentDir()) !== undefined;
      ctx.ui.notify([
        'Telegram status',
        `Bot token: ${tokenConfigured ? 'configured' : 'not configured'}`,
        `Private chat: ${paired ? 'paired' : 'not paired'}`,
        'Live connectivity: not checked',
        !tokenConfigured ? 'Set PI_TELEGRAM_BOT_TOKEN and restart Pi.' : '',
        !paired ? 'Run /telegram-pair to pair a private chat.' : '',
      ].filter(Boolean).join('\n'), 'info');
    },
  });
  pi.registerCommand('telegram-pair', {
    description: 'Pair a private Telegram chat with this Pi installation',
    handler: async (_args, ctx) => {
      const token = process.env.PI_TELEGRAM_BOT_TOKEN;
      if (!token) {
        ctx.ui.notify('Set PI_TELEGRAM_BOT_TOKEN before starting Pi', 'error');
        return;
      }
      const code = randomBytes(16).toString('hex');
      ctx.ui.notify(`Send /start ${code} to your Telegram bot within 5 minutes`, 'info');
      try {
        saveChatId(agentDir(), await pairChat(token, code));
        ctx.ui.notify('Private Telegram chat paired', 'info');
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'Telegram pairing failed', 'error');
      }
    },
  });
}
