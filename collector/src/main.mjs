import { AztecAdminClient } from './admin-client.mjs';
import { CollectorApiServer } from './api-server.mjs';
import { OffenseCollector } from './collector.mjs';
import { loadConfig } from './config.mjs';
import { OffenseRepository } from './database.mjs';
import { Logger, errorMessage } from './logger.mjs';

async function main() {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);
  const repository = new OffenseRepository(config.databasePath);
  const client = new AztecAdminClient({
    url: config.adminUrl,
    apiKey: config.adminApiKey,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    maxOffenses: config.maxOffensesPerPoll,
  });
  const collector = new OffenseCollector({
    client,
    repository,
    pollIntervalMs: config.pollIntervalMs,
    maxBackoffMs: config.maxBackoffMs,
    withdrawAfterMissedPolls: config.withdrawAfterMissedPolls,
    logger,
  });
  const api = new CollectorApiServer({
    repository,
    host: config.bindHost,
    port: config.port,
    corsOrigin: config.corsOrigin,
    staleAfterMs: config.staleAfterMs,
    publicConfig: {
      pollIntervalMs: config.pollIntervalMs,
      maxBackoffMs: config.maxBackoffMs,
      staleAfterMs: config.staleAfterMs,
      withdrawAfterMissedPolls: config.withdrawAfterMissedPolls,
    },
    logger,
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('Collector shutting down', { signal });
    await Promise.allSettled([collector.stop(), api.close()]);
    repository.close();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await api.listen();
    collector.start();
  } catch (error) {
    await shutdown('startup-error');
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    message: 'Collector failed',
    data: { error: errorMessage(error) },
  })}\n`);
  process.exitCode = 1;
});
