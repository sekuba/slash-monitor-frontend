import assert from 'node:assert/strict';
import test from 'node:test';

import { OffenseCollector, validateNodeIdentity } from '../src/collector.mjs';
import { SlashmonRepository } from '../src/database.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import { OFFENSE_A, OFFENSE_B, silentLogger } from './helpers.mjs';

const REGISTRY = `0x${'a'.repeat(40)}`;
const ROLLUP = `0x${'b'.repeat(40)}`;

test('node identity comparisons ignore Ethereum address casing', () => {
  assert.doesNotThrow(() => validateNodeIdentity({
    l1ChainId: 1,
    registryAddress: '0x35b22e09ee0390539439e24f06da43d83f90e298',
    rollupAddress: ROLLUP,
  }, {
    expectedChainId: 1,
    expectedRegistryAddress: '0x35b22e09Ee0390539439E24f06Da43D83f90e298',
    canonicalRollupAddress: `0x${'B'.repeat(40)}`,
  }));
});

test('collector retains data while the node is unavailable and recovers', async (t) => {
  const repository = new SlashmonRepository(':memory:');
  t.after(() => repository.close());
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: 1_000 });
  repository.recordSourceSuccess('l1', { rollupAddress: ROLLUP }, 1_500);

  const responses = [new Error('connection refused'), []];
  const client = {
    async getNodeInfo() {
      return { l1ChainId: 1, registryAddress: REGISTRY, rollupAddress: ROLLUP };
    },
    async getNodeSyncStatus() {
      return { ready: true, l1Timestamp: String(Math.floor(now / 1_000)), l2Slot: '100', l2Epoch: '100' };
    },
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
    expectedChainId: 1,
    expectedRegistryAddress: REGISTRY,
    pollIntervalMs: 1_000,
    maxBackoffMs: 2_000,
    resolveAfterMissedPolls: 2,
    logger: silentLogger,
    now: () => now,
  });

  const failed = await collector.runOnce();
  assert.equal(failed.ok, false);
  assert.equal(offenseById(repository, offense.id).missedPolls, 0);
  assert.equal(repository.getSyncState().consecutiveFailures, 1);

  now = 3_000;
  const recovered = await collector.runOnce();
  assert.equal(recovered.ok, true);
  assert.equal(repository.getSyncState().consecutiveFailures, 0);
  assert.equal(offenseById(repository, offense.id).missedPolls, 1);
  assert.equal(offenseById(repository, offense.id).status, 'active');
});

test('collector trusts no node offense until L1 establishes the canonical Rollup', async (t) => {
  const repository = new SlashmonRepository(':memory:');
  t.after(() => repository.close());
  let nodeCalls = 0;
  let offenseCalls = 0;
  const collector = new OffenseCollector({
    client: {
      async getNodeInfo() {
        nodeCalls += 1;
        return { l1ChainId: 1, registryAddress: REGISTRY, rollupAddress: ROLLUP };
      },
      async getNodeSyncStatus() {
        return { ready: true, l1Timestamp: '10', l2Slot: '100', l2Epoch: '100' };
      },
      async getAllSlashOffenses() {
        offenseCalls += 1;
        return parseOffenseSnapshot([OFFENSE_A]);
      },
    },
    repository,
    expectedChainId: 1,
    expectedRegistryAddress: REGISTRY,
    pollIntervalMs: 1_000,
    maxBackoffMs: 2_000,
    resolveAfterMissedPolls: 2,
    logger: silentLogger,
    now: () => 10_000,
  });

  const blocked = await collector.runOnce();
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Canonical L1 Rollup is unavailable/);
  assert.equal(nodeCalls, 0);
  assert.equal(offenseCalls, 0);
  assert.equal(repository.listOffenses({ status: 'all' }).length, 0);

  repository.recordSourceSuccess('l1', { rollupAddress: ROLLUP }, 10_000);
  const accepted = await collector.runOnce();
  assert.equal(accepted.ok, true);
  assert.equal(nodeCalls, 1);
  assert.equal(offenseCalls, 1);
  assert.equal(repository.listOffenses({ status: 'active' }).length, 1);
});

test('collector rejects offenses from a node with the wrong chain, Registry, or canonical Rollup', async (t) => {
  const cases = [
    {
      name: 'chain',
      nodeInfo: { l1ChainId: 11_155_111, registryAddress: REGISTRY, rollupAddress: ROLLUP },
      error: /L1 chain mismatch/,
    },
    {
      name: 'Registry',
      nodeInfo: { l1ChainId: 1, registryAddress: `0x${'c'.repeat(40)}`, rollupAddress: ROLLUP },
      error: /Registry mismatch/,
    },
    {
      name: 'Rollup',
      nodeInfo: { l1ChainId: 1, registryAddress: REGISTRY, rollupAddress: `0x${'d'.repeat(40)}` },
      error: /Rollup mismatch/,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const repository = new SlashmonRepository(':memory:');
      subtest.after(() => repository.close());
      const [offense] = parseOffenseSnapshot([OFFENSE_A]);
      repository.recordSuccessfulPoll([offense], { observedAt: 1_000 });
      repository.recordSourceSuccess('l1', { rollupAddress: ROLLUP }, 1_500);
      let offenseCalls = 0;
      const collector = new OffenseCollector({
        client: {
          async getNodeInfo() {
            return scenario.nodeInfo;
          },
          async getAllSlashOffenses() {
            offenseCalls += 1;
            return [];
          },
        },
        repository,
        expectedChainId: 1,
        expectedRegistryAddress: REGISTRY,
        pollIntervalMs: 1_000,
        maxBackoffMs: 2_000,
        resolveAfterMissedPolls: 2,
        logger: silentLogger,
        now: () => 2_000,
      });

      const result = await collector.runOnce();
      assert.equal(result.ok, false);
      assert.match(result.error, scenario.error);
      assert.equal(offenseCalls, 0);
      assert.equal(offenseById(repository, offense.id).status, 'active');
      assert.equal(offenseById(repository, offense.id).missedPolls, 0);
    });
  }
});

test('negative offense evidence advances only with the matching L2 cursor', async (t) => {
  const repository = new SlashmonRepository(':memory:');
  t.after(() => repository.close());
  const [epochOffense, slotOffense] = parseOffenseSnapshot([OFFENSE_A, OFFENSE_B]);
  repository.recordSuccessfulPoll([epochOffense, slotOffense], { observedAt: 900_000 });
  repository.recordSourceSuccess('l1', { rollupAddress: ROLLUP }, 900_000);
  let now = 1_000_000;
  let sync = { ready: true, l1Timestamp: '1000', l2Slot: '10000', l2Epoch: '50' };
  const collector = createCollector({ repository, now: () => now, sync: () => sync, offenses: () => [] });

  assert.equal((await collector.runOnce()).ok, true);
  assert.equal(offenseById(repository, epochOffense.id).missedPolls, 1);
  assert.equal(offenseById(repository, slotOffense.id).missedPolls, 1);

  now += 1_000;
  sync = { ...sync, l1Timestamp: '1001' };
  assert.equal((await collector.runOnce()).ok, true);
  assert.equal(offenseById(repository, epochOffense.id).missedPolls, 1);
  assert.equal(offenseById(repository, slotOffense.id).missedPolls, 1);

  now += 1_000;
  sync = { ...sync, l1Timestamp: '1002', l2Slot: '10001' };
  await collector.runOnce();
  assert.equal(offenseById(repository, epochOffense.id).missedPolls, 1);
  assert.equal(offenseById(repository, slotOffense.id).missedPolls, 2);

  now += 1_000;
  sync = { ...sync, l1Timestamp: '1003', l2Slot: '10002', l2Epoch: '51' };
  await collector.runOnce();
  assert.equal(offenseById(repository, epochOffense.id).missedPolls, 2);
  assert.equal(offenseById(repository, slotOffense.id).status, 'resolved');

  now += 1_000;
  sync = { ...sync, l1Timestamp: '1004', l2Slot: '10003', l2Epoch: '52' };
  await collector.runOnce();
  assert.equal(offenseById(repository, epochOffense.id).status, 'resolved');
});

test('unready, stale, stalled, or regressing sync retains absences but accepts positive offenses', async (t) => {
  const scenarios = [
    {
      name: 'unready',
      now: 1_001_000,
      sync: { ready: false, l1Timestamp: '1001', l2Slot: '10001', l2Epoch: '51' },
      error: /not ready/,
    },
    {
      name: 'stale L1',
      now: 1_006_000,
      sync: { ready: true, l1Timestamp: '1000', l2Slot: '10001', l2Epoch: '51' },
      error: /timestamp is stale/,
    },
    {
      name: 'stalled L2',
      now: 1_006_000,
      sync: { ready: true, l1Timestamp: '1006', l2Slot: '10000', l2Epoch: '50' },
      error: /slot has stalled/,
    },
    {
      name: 'regression',
      now: 1_001_000,
      sync: { ready: true, l1Timestamp: '1001', l2Slot: '9999', l2Epoch: '50' },
      error: /cursor regressed/,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const repository = new SlashmonRepository(':memory:');
      subtest.after(() => repository.close());
      const [positive, missing] = parseOffenseSnapshot([OFFENSE_A, OFFENSE_B]);
      repository.recordSuccessfulPoll([missing], { observedAt: 900_000 });
      repository.recordSourceSuccess('l1', { rollupAddress: ROLLUP }, 900_000);
      let now = 1_000_000;
      let sync = { ready: true, l1Timestamp: '1000', l2Slot: '10000', l2Epoch: '50' };
      let offenses = [];
      const collector = createCollector({
        repository,
        now: () => now,
        sync: () => sync,
        offenses: () => offenses,
        syncMaxL1AgeMs: 5_000,
        syncMaxL2StallMs: 5_000,
      });
      assert.equal((await collector.runOnce()).ok, true);
      assert.equal(offenseById(repository, missing.id).missedPolls, 1);

      now = scenario.now;
      sync = scenario.sync;
      offenses = [positive];
      const result = await collector.runOnce();
      assert.equal(result.ok, false);
      assert.match(result.error, scenario.error);
      assert.equal(offenseById(repository, missing.id).status, 'active');
      assert.equal(offenseById(repository, missing.id).missedPolls, 1);
      assert.equal(offenseById(repository, positive.id).status, 'active');
      assert.equal(repository.getSyncState().consecutiveFailures, 1);
    });
  }
});

function createCollector({
  repository,
  now,
  sync,
  offenses,
  syncMaxL1AgeMs = 5_000,
  syncMaxL2StallMs = 5_000,
}) {
  return new OffenseCollector({
    client: {
      async getNodeInfo() {
        return { l1ChainId: 1, registryAddress: REGISTRY, rollupAddress: ROLLUP };
      },
      async getNodeSyncStatus() {
        return sync();
      },
      async getAllSlashOffenses() {
        return offenses();
      },
    },
    repository,
    expectedChainId: 1,
    expectedRegistryAddress: REGISTRY,
    syncMaxL1AgeMs,
    syncMaxL2StallMs,
    syncMaxFutureSkewMs: 1_000,
    pollIntervalMs: 1_000,
    maxBackoffMs: 2_000,
    resolveAfterMissedPolls: 3,
    logger: silentLogger,
    now,
  });
}

function offenseById(repository, id) {
  return repository.listOffenses({ status: 'all', limit: 1_000 })
    .find((offense) => offense.id === id);
}
