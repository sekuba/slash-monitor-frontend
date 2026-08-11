// Shared lifecycle for the background workers: a start/stop-once loop, an
// interruptible sleep, abortable in-flight request tracking, and the common
// exponential backoff on consecutive source failures.
export class PollingWorker {
  constructor() {
    this.running = false;
    this.loopPromise = undefined;
    this.pendingSleep = undefined;
    this.activeControllers = new Set();
  }

  start() {
    if (this.running) return this.loopPromise;
    this.running = true;
    this.onStart?.();
    this.loopPromise = this.runLoop();
    return this.loopPromise;
  }

  async stop() {
    if (!this.running && !this.loopPromise) return;
    this.running = false;
    for (const controller of this.activeControllers) controller.abort();
    this.pendingSleep?.resolve();
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  trackRequest() {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    return controller;
  }

  releaseRequest(controller) {
    this.activeControllers.delete(controller);
  }

  async runLoop() {
    while (this.running) {
      const result = await this.runOnce();
      if (!this.running) break;
      const failures = result.ok ? 0 : result.consecutiveFailures ?? 1;
      await this.sleep(failures === 0
        ? this.pollIntervalMs
        : backoffDelayMs(this.pollIntervalMs, this.maxBackoffMs, failures));
    }
  }

  // Records the failure against the source, logs it with the durable failure
  // count, and returns the poll result the backoff loop expects.
  pollFailure(source, logMessage, message, at) {
    this.repository.recordSourceFailure(source, message, at);
    const state = this.repository.getSourceState(source);
    const consecutiveFailures = Number(state?.consecutiveFailures ?? 0);
    this.logger.warn(logMessage, { consecutiveFailures, error: message });
    return { ok: false, error: message, consecutiveFailures };
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

export function backoffDelayMs(baseMs, maxMs, failures) {
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures - 1, 16));
}
