import assert from 'node:assert/strict';
import test from 'node:test';

import { OffenseCollector } from '../src/collector.mjs';
import { OffenseRepository } from '../src/database.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import { OFFENSE_A, silentLogger } from './helpers.mjs';

test('collector retains data while the node is unavailable and recovers', async (t) => {
  const repository = new OffenseRepository(':memory:');
  t.after(() => repository.close());
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: 1_000 });

  const responses = [new Error('connection refused'), []];
  const client = {
    async getAllSlashOffenses() {
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
  let now = 2_000;
  const collector = new OffenseCollector({
    client,
    repository,
    pollIntervalMs: 1_000,
    maxBackoffMs: 2_000,
    withdrawAfterMissedPolls: 2,
    logger: silentLogger,
    now: () => now,
  });

  const failed = await collector.runOnce();
  assert.equal(failed.ok, false);
  assert.equal(repository.getOffense(offense.id).missedPolls, 0);
  assert.equal(repository.getSyncState().consecutiveFailures, 1);

  now = 3_000;
  const recovered = await collector.runOnce();
  assert.equal(recovered.ok, true);
  assert.equal(repository.getSyncState().consecutiveFailures, 0);
  assert.equal(repository.getOffense(offense.id).missedPolls, 1);
  assert.equal(repository.getOffense(offense.id).status, 'active');
});
