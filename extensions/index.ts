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
        'Telegram connection',
        '',
        'Configuration',
        `Bot token: ${tokenConfigured ? 'Configured' : 'Not configured'}`,
        `Private chat: ${paired ? 'Paired' : 'Not paired'}`,
        '',
        'Connectivity',
        'Live check: Not performed',
        ...(!tokenConfigured || !paired ? [
          '',
          'Next steps',
          ...(!tokenConfigured ? ['Set PI_TELEGRAM_BOT_TOKEN and restart Pi.'] : []),
          ...(!paired ? ['Run /telegram-pair to pair a private chat.'] : []),
        ] : []),
      ].join('\n'), 'info');
    },
  });
  pi.registerCommand('telegram-pair', {
    description: 'Pair a private Telegram chat with this Pi installation',
    handler: async (_args, ctx) => {
      const token = process.env.PI_TELEGRAM_BOT_TOKEN;
      if (!token) {
        ctx.ui.notify('Telegram pairing unavailable\n\nSet PI_TELEGRAM_BOT_TOKEN before starting Pi.', 'error');
        return;
      }
      const code = randomBytes(16).toString('hex');
      ctx.ui.notify([
        'Pair Telegram',
        '',
        'In your private chat with the bot, send:',
        '',
        `/start ${code}`,
        '',
        'Code expires in 5 minutes.',
      ].join('\n'), 'info');
      try {
        saveChatId(agentDir(), await pairChat(token, code));
        ctx.ui.notify('Telegram paired\n\nPrivate chat linked successfully.', 'info');
      } catch (error) {
        ctx.ui.notify(`Telegram pairing failed\n\n${error instanceof Error ? error.message : 'Telegram pairing failed'}`, 'error');
      }
    },
  });
}
