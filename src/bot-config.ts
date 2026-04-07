import fs from 'node:fs';
import path from 'node:path';

import type { BotInstance } from 'claude-to-im/src/lib/bridge/host.js';

import { CTI_HOME, loadConfig, type Config } from './config.js';

const BOTS_PATH = path.join(CTI_HOME, 'bots.json');

export interface BotConfigFile {
  version: 1;
  bots: BotInstance[];
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function ensureHomeDir(): void {
  fs.mkdirSync(CTI_HOME, { recursive: true });
}

function toCsvArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((item) => String(item).trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function sanitizeBotId(input: string): string {
  return input.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function botForLegacyChannel(channelType: string, config: Config): BotInstance | null {
  const id = `${sanitizeBotId(channelType)}_default`;
  const defaults = {
    workdir: config.defaultWorkDir,
    ...(config.defaultModel ? { model: config.defaultModel } : {}),
    mode: config.defaultMode as 'code' | 'plan' | 'ask',
  };

  if (channelType === 'telegram' && config.tgBotToken) {
    return {
      id,
      channelType,
      enabled: true,
      credentials: {
        botToken: config.tgBotToken,
        ...(config.tgChatId ? { chatId: config.tgChatId } : {}),
      },
      defaults,
      ...(config.tgAllowedUsers ? { security: { allowedUsers: config.tgAllowedUsers } } : {}),
      metadata: { name: 'Telegram Default' },
    };
  }

  if (channelType === 'feishu' && config.feishuAppId && config.feishuAppSecret) {
    return {
      id,
      channelType,
      enabled: true,
      credentials: {
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
        domain: config.feishuDomain || 'feishu',
      },
      defaults,
      ...(config.feishuAllowedUsers ? { security: { allowedUsers: config.feishuAllowedUsers } } : {}),
      metadata: { name: 'Feishu Default' },
    };
  }

  if (channelType === 'discord' && config.discordBotToken) {
    return {
      id,
      channelType,
      enabled: true,
      credentials: {
        botToken: config.discordBotToken,
      },
      defaults,
      security: {
        ...(config.discordAllowedUsers ? { allowedUsers: config.discordAllowedUsers } : {}),
        ...(config.discordAllowedChannels ? { allowedChannels: config.discordAllowedChannels } : {}),
        ...(config.discordAllowedGuilds ? { allowedGuilds: config.discordAllowedGuilds } : {}),
      },
      metadata: { name: 'Discord Default' },
    };
  }

  if (channelType === 'qq' && config.qqAppId && config.qqAppSecret) {
    return {
      id,
      channelType,
      enabled: true,
      credentials: {
        appId: config.qqAppId,
        appSecret: config.qqAppSecret,
      },
      defaults,
      security: {
        ...(config.qqAllowedUsers ? { allowedUsers: config.qqAllowedUsers } : {}),
      },
      features: {
        ...(config.qqImageEnabled !== undefined ? { imageEnabled: config.qqImageEnabled } : {}),
        ...(config.qqMaxImageSize !== undefined ? { maxImageSize: config.qqMaxImageSize } : {}),
      },
      metadata: { name: 'QQ Default' },
    };
  }

  if (channelType === 'weixin') {
    return {
      id,
      channelType,
      enabled: true,
      credentials: {},
      defaults,
      features: {
        ...(config.weixinMediaEnabled !== undefined ? { mediaEnabled: config.weixinMediaEnabled } : {}),
        ...(config.weixinBaseUrl ? { baseUrl: config.weixinBaseUrl } : {}),
        ...(config.weixinCdnBaseUrl ? { cdnBaseUrl: config.weixinCdnBaseUrl } : {}),
      },
      metadata: { name: 'WeChat Default' },
    };
  }

  return null;
}

function normalizeBot(bot: BotInstance): BotInstance {
  return {
    id: sanitizeBotId(bot.id),
    channelType: bot.channelType,
    enabled: bot.enabled !== false,
    credentials: bot.credentials || {},
    defaults: {
      workdir: String(bot.defaults?.workdir || process.env.HOME || ''),
      ...(bot.defaults?.model ? { model: String(bot.defaults.model) } : {}),
      mode: (bot.defaults?.mode || 'code') as 'code' | 'plan' | 'ask',
      ...(bot.defaults?.providerId ? { providerId: String(bot.defaults.providerId) } : {}),
    },
    ...(bot.security ? { security: bot.security } : {}),
    ...(bot.features ? { features: bot.features } : {}),
    ...(bot.metadata ? { metadata: bot.metadata } : {}),
  };
}

export function validateBot(bot: BotInstance): string | null {
  if (!bot.id.trim()) return 'Bot id is required.';
  if (!bot.channelType.trim()) return 'Channel type is required.';
  if (!path.isAbsolute(bot.defaults.workdir)) return 'Default workdir must be an absolute path.';

  if (bot.channelType === 'telegram' && !String(bot.credentials.botToken || '').trim()) {
    return 'Telegram botToken is required.';
  }
  if (bot.channelType === 'feishu') {
    if (!String(bot.credentials.appId || '').trim()) return 'Feishu appId is required.';
    if (!String(bot.credentials.appSecret || '').trim()) return 'Feishu appSecret is required.';
  }
  if (bot.channelType === 'discord' && !String(bot.credentials.botToken || '').trim()) {
    return 'Discord botToken is required.';
  }
  if (bot.channelType === 'qq') {
    if (!String(bot.credentials.appId || '').trim()) return 'QQ appId is required.';
    if (!String(bot.credentials.appSecret || '').trim()) return 'QQ appSecret is required.';
  }

  return null;
}

export function buildLegacyBots(config: Config): BotConfigFile {
  const bots = (config.enabledChannels || [])
    .map((channelType) => botForLegacyChannel(channelType, config))
    .filter((bot): bot is BotInstance => Boolean(bot))
    .map(normalizeBot);

  return { version: 1, bots };
}

export function loadBotsConfig(config = loadConfig()): BotConfigFile {
  try {
    const raw = JSON.parse(fs.readFileSync(BOTS_PATH, 'utf-8')) as BotConfigFile;
    const bots = Array.isArray(raw.bots) ? raw.bots.map(normalizeBot) : [];
    return { version: 1, bots };
  } catch {
    const migrated = buildLegacyBots(config);
    if (migrated.bots.length > 0) {
      saveBotsConfig(migrated);
    }
    return migrated;
  }
}

export function saveBotsConfig(config: BotConfigFile): void {
  ensureHomeDir();
  const normalizedBots = config.bots.map(normalizeBot);
  atomicWrite(BOTS_PATH, JSON.stringify({ version: 1, bots: normalizedBots }, null, 2));
}

export function listBots(config = loadBotsConfig()): BotInstance[] {
  return config.bots.map(normalizeBot);
}

export function addBot(bot: BotInstance, config = loadBotsConfig()): BotConfigFile {
  const normalized = normalizeBot(bot);
  const validationError = validateBot(normalized);
  if (validationError) throw new Error(validationError);
  if (config.bots.some((entry) => entry.id === normalized.id)) {
    throw new Error(`Bot ${normalized.id} already exists.`);
  }
  const next = { version: 1 as const, bots: [...config.bots, normalized] };
  saveBotsConfig(next);
  return next;
}

export function deleteBot(id: string, config = loadBotsConfig()): BotConfigFile {
  const nextBots = config.bots.filter((bot) => bot.id !== id);
  if (nextBots.length === config.bots.length) {
    throw new Error(`Bot ${id} not found.`);
  }
  const next = { version: 1 as const, bots: nextBots };
  saveBotsConfig(next);
  return next;
}

export function buildBotFromCommand(input: {
  id: string;
  channelType: string;
  workdir: string;
  params: Record<string, string>;
}): BotInstance {
  const channelType = input.channelType.trim().toLowerCase();
  const allowedUsers = input.params.allowedUsers
    ? input.params.allowedUsers.split(',').map((item) => item.trim()).filter(Boolean)
    : undefined;
  const defaults = {
    workdir: input.workdir,
    ...(input.params.model ? { model: input.params.model } : {}),
    mode: ((input.params.mode || 'code').trim() as 'code' | 'plan' | 'ask'),
    ...(input.params.providerId ? { providerId: input.params.providerId } : {}),
  };

  if (channelType === 'telegram') {
    return {
      id: input.id,
      channelType,
      enabled: true,
      credentials: {
        botToken: input.params.botToken || '',
        ...(input.params.chatId ? { chatId: input.params.chatId } : {}),
      },
      defaults,
      ...(allowedUsers ? { security: { allowedUsers } } : {}),
    };
  }

  if (channelType === 'feishu') {
    return {
      id: input.id,
      channelType,
      enabled: true,
      credentials: {
        appId: input.params.appId || '',
        appSecret: input.params.appSecret || '',
        domain: input.params.domain || 'feishu',
      },
      defaults,
      ...(allowedUsers ? { security: { allowedUsers } } : {}),
    };
  }

  if (channelType === 'discord') {
    return {
      id: input.id,
      channelType,
      enabled: true,
      credentials: { botToken: input.params.botToken || '' },
      defaults,
      security: {
        ...(allowedUsers ? { allowedUsers } : {}),
        ...(toCsvArray(input.params.allowedChannels?.split(',')) ? { allowedChannels: input.params.allowedChannels.split(',').map((item) => item.trim()).filter(Boolean) } : {}),
        ...(toCsvArray(input.params.allowedGuilds?.split(',')) ? { allowedGuilds: input.params.allowedGuilds.split(',').map((item) => item.trim()).filter(Boolean) } : {}),
      },
    };
  }

  if (channelType === 'qq') {
    return {
      id: input.id,
      channelType,
      enabled: true,
      credentials: {
        appId: input.params.appId || '',
        appSecret: input.params.appSecret || '',
      },
      defaults,
      ...(allowedUsers ? { security: { allowedUsers } } : {}),
      features: {
        ...(input.params.imageEnabled ? { imageEnabled: input.params.imageEnabled === 'true' } : {}),
        ...(input.params.maxImageSize ? { maxImageSize: Number(input.params.maxImageSize) } : {}),
      },
    };
  }

  if (channelType === 'weixin') {
    return {
      id: input.id,
      channelType,
      enabled: true,
      credentials: {},
      defaults,
      features: {
        ...(input.params.mediaEnabled ? { mediaEnabled: input.params.mediaEnabled === 'true' } : {}),
      },
    };
  }

  return {
    id: input.id,
    channelType,
    enabled: true,
    credentials: {},
    defaults,
  };
}

export { BOTS_PATH };
