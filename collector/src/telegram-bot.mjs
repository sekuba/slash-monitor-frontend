import { hashToken } from './security.mjs';
import { errorMessage } from './logger.mjs';
import { PollingWorker } from './polling-worker.mjs';

export class TelegramBot extends PollingWorker {
  constructor({
    client,
    repository,
    expectedUsername,
    pollTimeoutSeconds = 25,
    commandReplyCooldownMs = 2_000,
    onReadinessChange = () => {},
    logger,
    now = Date.now,
  }) {
    super();
    this.client = client;
    this.repository = repository;
    this.expectedUsername = expectedUsername;
    this.pollTimeoutSeconds = pollTimeoutSeconds;
    this.logger = logger;
    this.now = now;
    this.commandReplyCooldownMs = commandReplyCooldownMs;
    this.commandReplyDeadlines = new Map();
    this.onReadinessChange = onReadinessChange;
  }

  async runLoop() {
    await this.removeWebhookWithRetry();
    let failures = 0;
    while (this.running) {
      const controller = this.trackRequest();
      this.repository.recordSourceAttempt('telegram', this.now());
      try {
        const offset = this.repository.getTelegramOffset();
        const updates = await this.client.getUpdates({
          offset,
          timeout: this.pollTimeoutSeconds,
          signal: controller.signal,
        });
        for (const update of updates) {
          await this.processUpdate(update, controller.signal);
          this.repository.setTelegramOffset(Number(update.update_id) + 1);
        }
        this.repository.recordSourceSuccess('telegram', {
          offset: this.repository.getTelegramOffset(),
        }, this.now());
        if (failures > 0) this.logger.info('Telegram bot connection recovered', { previousFailures: failures });
        failures = 0;
      } catch (error) {
        if (!this.running && controller.signal.aborted) break;
        if (Number(error?.statusCode) === 401) this.onReadinessChange(false);
        failures += 1;
        const message = errorMessage(error);
        this.repository.recordSourceFailure('telegram', message, this.now());
        this.logger.warn('Telegram long poll failed', { consecutiveFailures: failures, error: message });
        await this.sleep(Math.min(60_000, 1_000 * 2 ** Math.min(failures - 1, 6)));
      } finally {
        this.releaseRequest(controller);
      }
    }
  }

  async removeWebhookWithRetry() {
    let failures = 0;
    let identityValidated = false;
    while (this.running) {
      const controller = this.trackRequest();
      try {
        if (!identityValidated) {
          const bot = await this.client.getMe(controller.signal);
          if (this.expectedUsername && (
            !bot?.username || bot.username.toLowerCase() !== this.expectedUsername.toLowerCase()
          )) {
            throw new TelegramIdentityError(
              `Telegram token belongs to @${bot?.username ?? 'unknown'}, expected @${this.expectedUsername}`,
            );
          }
          identityValidated = true;
        }
        await this.client.deleteWebhook(controller.signal);
        this.onReadinessChange(true);
        return;
      } catch (error) {
        if (!this.running && controller.signal.aborted) return;
        failures += 1;
        const message = errorMessage(error);
        this.repository.recordSourceFailure?.('telegram', message, this.now());
        const identityMismatch = error instanceof TelegramIdentityError;
        if (identityMismatch || Number(error?.statusCode) === 401) this.onReadinessChange(false);
        this.logger[identityMismatch ? 'error' : 'warn'](
          identityMismatch
            ? 'Telegram identity mismatch; channel remains isolated while the watchtower continues'
            : 'Unable to switch Telegram bot to long polling yet', {
          consecutiveFailures: failures,
          error: message,
        });
        await this.sleep(Math.min(60_000, 1_000 * 2 ** Math.min(failures - 1, 6)));
      } finally {
        this.releaseRequest(controller);
      }
    }
  }

  async processUpdate(update, signal) {
    const message = update?.message;
    if (!message || typeof message.text !== 'string') return;
    const chatId = String(message.chat?.id ?? '');
    if (!chatId || message.chat?.type !== 'private') return;
    const text = message.text.trim();
    if (!text) return;
    const [rawCommand, argument = ''] = text.split(/\s+/, 2);
    const command = rawCommand.toLowerCase().replace(/@[^\s]+$/, '');

    let response;
    if (command === '/start') {
      if (argument) {
        // An opaque, single-use link is the only unauthenticated command that
        // can earn a reply. Random/expired tokens are deliberately silent so
        // strangers cannot spend the bot-wide send budget needed by alerts.
        response = this.link(chatId, argument);
        if (!response || !this.takeCommandReplySlot(chatId)) return;
      } else {
        if (!this.repository.getWatchByTelegramChat?.(chatId)) return;
        if (!this.takeCommandReplySlot(chatId)) return;
        response = helpText();
      }
    } else {
      const linked = this.repository.getWatchByTelegramChat?.(chatId);
      if (!linked || !KNOWN_LINKED_COMMANDS.has(command)) return;
      if (command === '/list' || command === '/status') {
        response = this.describe(chatId, linked);
      } else if (command === '/pause') {
        const changed = this.repository.setTelegramEndpointEnabled(chatId, false, this.now());
        response = changed ? 'Alerts paused. Your watch is intact. Send /resume when ready.' : undefined;
      } else if (command === '/resume') {
        const changed = this.repository.setTelegramEndpointEnabled(chatId, true, this.now());
        response = changed ? 'Alerts resumed.' : undefined;
      } else if (command === '/delete') {
        const changed = this.repository.deleteTelegramEndpoint(chatId);
        response = changed ? 'Telegram disconnected. No chat endpoint was retained.' : undefined;
      } else if (command === '/test') {
        response = '🛰️ Test received. slashveto.me can reach this chat.';
      } else if (command === '/help') {
        response = helpText();
      }
    }

    if (!response) return;
    // Mutating commands above are durable even when a preceding reply used the
    // chat's small reply budget. Only the optional acknowledgement is dropped.
    if (command !== '/start' && !this.takeCommandReplySlot(chatId)) return;

    try {
      await this.client.sendMessage(chatId, response, signal, { priority: 'low' });
    } catch (error) {
      // The command mutation is already durable. Advancing the update avoids
      // replaying a single-use link or destructive command after a send timeout.
      this.logger.warn('Telegram command reply failed', {
        updateId: update.update_id,
        error: errorMessage(error),
      });
    }
  }

  link(chatId, token) {
    let tokenHash;
    try {
      tokenHash = hashToken(token);
    } catch {
      return null;
    }
    const watch = this.repository.consumeTelegramLink(tokenHash, chatId, this.now());
    if (!watch) return null;
    return `Linked. Watching ${watch.addresses.length} sequencer${watch.addresses.length === 1 ? '' : 's'} on ${watch.network}.\n\n${formatAddresses(watch.addresses)}`;
  }

  describe(chatId, knownWatch) {
    const watch = knownWatch ?? this.repository.getWatchByTelegramChat(chatId);
    if (!watch) return null;
    return `${watch.telegramEnabled ? 'Alerts live' : 'Alerts paused'} for ${watch.addresses.length} sequencer${watch.addresses.length === 1 ? '' : 's'} on ${watch.network}.\n\n${formatAddresses(watch.addresses)}`;
  }

  takeCommandReplySlot(chatId) {
    const now = this.now();
    const deadline = this.commandReplyDeadlines.get(chatId) ?? 0;
    if (deadline > now) return false;
    if (!this.commandReplyDeadlines.has(chatId) && this.commandReplyDeadlines.size >= 10_000) {
      for (const [key, value] of this.commandReplyDeadlines) {
        if (value <= now) this.commandReplyDeadlines.delete(key);
      }
      while (this.commandReplyDeadlines.size >= 10_000) {
        const oldest = this.commandReplyDeadlines.keys().next().value;
        if (oldest === undefined) break;
        this.commandReplyDeadlines.delete(oldest);
      }
    }
    // Refresh insertion order as a cheap bounded-LRU eviction policy.
    this.commandReplyDeadlines.delete(chatId);
    this.commandReplyDeadlines.set(chatId, now + this.commandReplyCooldownMs);
    return true;
  }

}

class TelegramIdentityError extends Error {}

const KNOWN_LINKED_COMMANDS = new Set([
  '/list',
  '/status',
  '/pause',
  '/resume',
  '/delete',
  '/test',
  '/help',
]);

function formatAddresses(addresses) {
  return addresses.map((address) => `• ${address}`).join('\n');
}

function helpText() {
  return [
    'slashveto.me follows each sequencer from early node evidence through L1 slashing and ejection.',
    '',
    '/list — show the linked watch',
    '/pause — silence Telegram alerts',
    '/resume — wake them up',
    '/test — test this chat',
    '/delete — unlink this chat',
    '/help — show this text',
    '',
    'Addresses are managed in PINGME. Node and Sentinel evidence is an early warning, not L1 proof.',
  ].join('\n');
}
