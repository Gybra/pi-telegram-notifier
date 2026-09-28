import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const stateFile = (agentDir) => join(agentDir, 'pi-telegram-notifier.json');

export function loadChatId(agentDir) {
  try {
    const id = JSON.parse(readFileSync(stateFile(agentDir), 'utf8')).chatId;
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function saveChatId(agentDir, chatId) {
  if (!Number.isSafeInteger(chatId) || chatId <= 0) throw new Error('Invalid private chat ID');
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const temporary = `${stateFile(agentDir)}.${randomBytes(8).toString('hex')}`;
  writeFileSync(temporary, JSON.stringify({ chatId }), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, stateFile(agentDir));
}

export async function pairChat(token, code, fetchImpl = fetch, now = Date.now) {
  const expires = now() + 300_000;
  let offset = 0;
  while (now() < expires) {
    let response;
    try {
      const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
      url.searchParams.set('timeout', '20');
      url.searchParams.set('offset', String(offset));
      response = await fetchImpl(url, { signal: AbortSignal.timeout(25_000) });
    } catch {
      throw new Error('Telegram pairing request failed');
    }
    if (response.status === 409) throw new Error('Telegram webhook or another getUpdates consumer is active');
    if (!response.ok) throw new Error(`Telegram pairing failed (HTTP ${response.status})`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Invalid Telegram pairing response'); }
    if (!data.ok || !Array.isArray(data.result)) throw new Error('Invalid Telegram pairing response');
    for (const update of data.result) {
      offset = Math.max(offset, update.update_id + 1);
      if (now() < expires && update.message?.chat?.type === 'private' &&
          update.message.text === `/start ${code}` &&
          Number.isSafeInteger(update.message.chat.id) && update.message.chat.id > 0) {
        return update.message.chat.id;
      }
    }
  }
  throw new Error('Telegram pairing code expired');
}

export async function sendTelegram(token, chatId, text, fetchImpl = fetch) {
  let part = '';
  const chunks = [];
  for (const character of text) {
    if (part.length + character.length > 4096) {
      chunks.push(part);
      part = '';
    }
    part += character;
  }
  if (part) chunks.push(part);
  for (const chunk of chunks) {
    let response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Telegram delivery request failed');
    }
    if (!response.ok) throw new Error(`Telegram delivery failed (HTTP ${response.status})`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Invalid Telegram delivery response'); }
    if (!data.ok) throw new Error('Telegram delivery failed');
  }
}
