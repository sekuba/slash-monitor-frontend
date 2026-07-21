import { errorMessage } from './logger.mjs';

export class OffenseCollector {
  constructor({ client, repository, pollIntervalMs, maxBackoffMs, withdrawAfterMissedPolls, logger, now = Date.now }) {
    this.client = client;
    this.repository = repository;
    this.pollIntervalMs = pollIntervalMs;
    this.maxBackoffMs = maxBackoffMs;
    this.withdrawAfterMissedPolls = withdrawAfterMissedPolls;
    this.logger = logger;
    this.now = now;
    this.running = false;
    this.loopPromise = undefined;
    this.activeRequest = undefined;
    this.pendingSleep = undefined;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop() {
    if (!this.running && !this.loopPromise) {
      return;
    }
    this.running = false;
    this.activeRequest?.abort();
    this.pendingSleep?.resolve();
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  async runOnce() {
    const attemptedAt = this.now();
    this.repository.recordAttempt(attemptedAt);
    const controller = new AbortController();
    this.activeRequest = controller;

    try {
      const offenses = await this.client.getAllSlashOffenses(controller.signal);
      const previousFailures = this.repository.getSyncState().consecutiveFailures;
      const result = this.repository.recordSuccessfulPoll(offenses, {
        observedAt: this.now(),
        withdrawAfterMissedPolls: this.withdrawAfterMissedPolls,
      });
      if (previousFailures > 0) {
        this.logger.info('Aztec admin connection recovered', { previousFailures });
      }
      this.logger.debug('Offense poll completed', result);
      if (result.inserted || result.reactivated || result.withdrawn) {
        this.logger.info('Offense state changed', result);
      }
      return { ok: true, ...result };
    } catch (error) {
      if (!this.running && controller.signal.aborted) {
        return { ok: false, stopped: true };
      }
      const message = errorMessage(error);
      this.repository.recordFailure(message, this.now());
      const state = this.repository.getSyncState();
      this.logger.warn('Offense poll failed; retained the last successful snapshot', {
        consecutiveFailures: state.consecutiveFailures,
        error: message,
      });
      return { ok: false, error: message, consecutiveFailures: state.consecutiveFailures };
    } finally {
      if (this.activeRequest === controller) {
        this.activeRequest = undefined;
      }
    }
  }

  async runLoop() {
    while (this.running) {
      const result = await this.runOnce();
      if (!this.running) {
        break;
      }
      const failures = result.ok ? 0 : result.consecutiveFailures ?? 1;
      const delay = failures === 0
        ? this.pollIntervalMs
        : Math.min(this.maxBackoffMs, this.pollIntervalMs * 2 ** Math.min(failures - 1, 16));
      await this.sleep(delay);
    }
  }

  sleep(delay) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingSleep = undefined;
        resolve();
      }, delay);
      this.pendingSleep = {
        resolve: () => {
          clearTimeout(timer);
          this.pendingSleep = undefined;
          resolve();
        },
      };
    });
  }
}
