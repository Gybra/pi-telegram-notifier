import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { pairChat, saveChatId } from '../src/telegram.js';
import { registerNotifications } from '../src/notification.js';

const agentDir = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');

export default function (pi: ExtensionAPI) {
  registerNotifications(pi, agentDir(), process.env.PI_TELEGRAM_BOT_TOKEN);
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
