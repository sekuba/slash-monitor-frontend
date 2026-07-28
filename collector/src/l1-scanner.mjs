import { createPublicClient, getAddress, http, zeroAddress } from 'viem';

import {
  canonicalRollupUpdatedEvent,
  registryAbi,
  rollupAbi,
  slashedEvent,
  slasherAbi,
  slashingProposerAbi,
} from './l1-abis.mjs';

const MAX_RESOLVED_ROLLUPS = 256;

export class L1Scanner {
  constructor({
    rpcUrls,
    chainId,
    registryAddress,
    confirmations = 2,
    requestTimeoutMs = 15_000,
    snapshotTimeoutMs = 120_000,
    maxHeadAgeMs = 15 * 60_000,
    maxHeadStallMs = 2 * 60_000,
    maxFutureSkewMs = 2 * 60_000,
    slashLogLookbackBlocks = 600,
    slashLogChunkSize = 1_000,
    slashLogOverlapBlocks = 12,
    slashLogReorgRewindBlocks = 128,
    slashLogProviderTimeoutMs = 5_000,
    clientFactory,
    now = Date.now,
  }) {
    this.rpcUrls = rpcUrls;
    this.chainId = chainId;
    this.registryAddress = getAddress(registryAddress);
    this.confirmations = BigInt(confirmations);
    this.requestTimeoutMs = requestTimeoutMs;
    this.snapshotTimeoutMs = snapshotTimeoutMs;
    this.maxHeadAgeMs = maxHeadAgeMs;
    this.maxHeadStallMs = maxHeadStallMs;
    this.maxFutureSkewMs = maxFutureSkewMs;
    this.slashLogLookbackBlocks = BigInt(slashLogLookbackBlocks);
    this.slashLogChunkSize = BigInt(slashLogChunkSize);
    this.slashLogOverlapBlocks = BigInt(slashLogOverlapBlocks);
    this.slashLogReorgRewindBlocks = BigInt(slashLogReorgRewindBlocks);
    this.slashLogProviderTimeoutMs = slashLogProviderTimeoutMs;
    if (!Number.isSafeInteger(this.slashLogProviderTimeoutMs) || this.slashLogProviderTimeoutMs < 1) {
      throw new RangeError('slash log provider timeout must be a positive integer');
    }
    this.clientFactory = clientFactory ?? ((rpcUrl, signal) => createPublicClient({
      transport: http(rpcUrl, {
        timeout: this.requestTimeoutMs,
        retryCount: 0,
        fetchOptions: { signal },
      }),
    }));
    if (this.slashLogLookbackBlocks < 1n) throw new RangeError('slash log lookback must be positive');
    if (this.slashLogChunkSize < 2n) throw new RangeError('slash log chunk size must be at least 2');
    if (this.slashLogOverlapBlocks < 1n || this.slashLogOverlapBlocks >= this.slashLogChunkSize) {
      throw new RangeError('slash log overlap must be positive and smaller than the chunk size');
    }
    if (this.slashLogReorgRewindBlocks < this.slashLogOverlapBlocks) {
      throw new RangeError('slash log reorg rewind must be at least the overlap');
    }
    this.now = now;
    this.nextProviderIndex = 0;
    this.nextLogProviderIndex = 0;
  }

  async scan(previous = {}, signal) {
    const errors = [];
    for (let offset = 0; offset < this.rpcUrls.length; offset += 1) {
      const providerIndex = (this.nextProviderIndex + offset) % this.rpcUrls.length;
      const timeoutSignal = AbortSignal.timeout(this.snapshotTimeoutMs);
      const providerSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const client = this.clientFactory(this.rpcUrls[providerIndex], providerSignal, providerIndex);
      try {
        const snapshot = await this.scanWithClient(client, previous);
        this.nextProviderIndex = providerIndex;
        return snapshot;
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        if (timeoutSignal.aborted) {
          errors.push(`provider ${providerIndex + 1}: complete snapshot timed out after ${this.snapshotTimeoutMs}ms`);
          continue;
        }
        errors.push(`provider ${providerIndex + 1}: ${sanitizeRpcError(error)}`);
      }
    }
    throw new Error(`Every configured L1 RPC failed a complete snapshot (${errors.join('; ')})`);
  }

  /**
   * Scan at most one durable range of confirmed Slashed logs. The caller must
   * commit the returned checkpoint together with its events before asking for
   * the next chunk. That makes a crash repeat work instead of skipping it.
   */
  async scanSlashLogChunk(previous = {}, signal) {
    const errors = [];
    for (let offset = 0; offset < this.rpcUrls.length; offset += 1) {
      const providerIndex = (this.nextLogProviderIndex + offset) % this.rpcUrls.length;
      const timeoutSignal = AbortSignal.timeout(this.slashLogProviderTimeoutMs);
      const providerSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const client = this.clientFactory(this.rpcUrls[providerIndex], providerSignal, providerIndex);
      try {
        const chunk = await this.scanSlashLogChunkWithClient(client, previous);
        this.nextLogProviderIndex = providerIndex;
        return chunk;
      } catch (error) {
        if (signal?.aborted) {
          // The collector's absolute backfill budget won the race. Do not let
          // the same hanging primary consume every future run; start with the
          // next configured RPC when collection resumes.
          this.nextLogProviderIndex = (providerIndex + 1) % this.rpcUrls.length;
          throw error;
        }
        if (timeoutSignal.aborted) {
          errors.push(
            `provider ${providerIndex + 1}: slash log chunk timed out after ${this.slashLogProviderTimeoutMs}ms`,
          );
          continue;
        }
        errors.push(`provider ${providerIndex + 1}: ${sanitizeRpcError(error)}`);
      }
    }
    throw new Error(`Every configured L1 RPC failed a slash log chunk (${errors.join('; ')})`);
  }

  async scanSlashLogChunkWithClient(client, previous = {}) {
    const actualChainId = await client.getChainId();
    if (actualChainId !== this.chainId) {
      throw new Error(`chain id ${actualChainId}, expected ${this.chainId}`);
    }

    const head = await client.getBlock({ blockTag: 'latest' });
    if (head.number === null || !head.hash) throw new Error('latest L1 block has no number or hash');
    this.assertFreshTimestamp(head.timestamp);
    if (head.number < this.confirmations) {
      throw new Error(`L1 head ${head.number} is below confirmation depth ${this.confirmations}`);
    }
    const confirmedBlockNumber = head.number - this.confirmations;
    this.assertHeadProgress(head, previous, confirmedBlockNumber);
    const confirmedBlock = this.confirmations === 0n
      ? head
      : await client.getBlock({ blockNumber: confirmedBlockNumber });
    if (!confirmedBlock.hash) {
      throw new Error(`confirmed L1 block ${confirmedBlockNumber} has no hash`);
    }

    const cursorNumber = readOptionalBigInt(previous.lastBlockNumber);
    const cursorHash = previous.lastBlockHash;
    if ((cursorNumber === undefined) !== !cursorHash) {
      throw new Error('persisted slash log checkpoint is incomplete');
    }

    let reorgDetected = false;
    if (cursorNumber !== undefined) {
      if (cursorNumber > confirmedBlockNumber) {
        reorgDetected = true;
      } else {
        const canonicalCursor = cursorNumber === confirmedBlockNumber
          ? confirmedBlock
          : await client.getBlock({ blockNumber: cursorNumber });
        if (!canonicalCursor.hash || canonicalCursor.hash.toLowerCase() !== String(cursorHash).toLowerCase()) {
          reorgDetected = true;
        }
      }
    }

    let fromBlock;
    if (cursorNumber === undefined) {
      fromBlock = confirmedBlockNumber + 1n > this.slashLogLookbackBlocks
        ? confirmedBlockNumber + 1n - this.slashLogLookbackBlocks
        : 0n;
    } else if (reorgDetected) {
      fromBlock = cursorNumber + 1n > this.slashLogReorgRewindBlocks
        ? cursorNumber + 1n - this.slashLogReorgRewindBlocks
        : 0n;
      if (fromBlock > confirmedBlockNumber) fromBlock = 0n;
    } else {
      fromBlock = cursorNumber + 1n > this.slashLogOverlapBlocks
        ? cursorNumber + 1n - this.slashLogOverlapBlocks
        : 0n;
    }
    const toBlock = minBigInt(confirmedBlockNumber, fromBlock + this.slashLogChunkSize - 1n);
    const checkpointBlock = toBlock === confirmedBlockNumber
      ? confirmedBlock
      : await client.getBlock({ blockNumber: toBlock });
    if (!checkpointBlock.hash) throw new Error(`L1 log checkpoint ${toBlock} has no hash`);

    // Resolve emitters from the canonical Registry view for this exact range.
    // Carrying a flat emitter set across checkpoints would preserve an address
    // introduced only on an orphaned fork and could turn its later logs into
    // false slash confirmations after a reorg.
    const knownRollups = new Set();

    const registryUpdates = await client.getLogs({
      address: this.registryAddress,
      event: canonicalRollupUpdatedEvent,
      fromBlock,
      toBlock,
      strict: true,
    });
    for (const update of registryUpdates) {
      if (!update.args?.instance) throw new Error('Registry update log is missing its Rollup instance');
      addResolvedRollup(knownRollups, update.args.instance);
    }

    // Resolve both ends of the range. The start address covers an upgrade that
    // happened before this bounded scan; update logs cover every change inside
    // it; the end read is a defense-in-depth check for an RPC decoder quirk.
    const registryCodeAtStart = await client.getBytecode({ address: this.registryAddress, blockNumber: fromBlock });
    if (registryCodeAtStart && registryCodeAtStart !== '0x') {
      addResolvedRollup(knownRollups, await read(
        client,
        this.registryAddress,
        registryAbi,
        'getCanonicalRollup',
        fromBlock,
      ));
    }
    const registryCodeAtEnd = await client.getBytecode({ address: this.registryAddress, blockNumber: toBlock });
    if (registryCodeAtEnd && registryCodeAtEnd !== '0x') {
      addResolvedRollup(knownRollups, await read(
        client,
        this.registryAddress,
        registryAbi,
        'getCanonicalRollup',
        toBlock,
      ));
    }
    // A deliberately large first lookback may begin before Registry
    // deployment. Such chunks are valid empty history and must still advance
    // the cursor, or startup would wedge forever on its first range.
    if (knownRollups.size > MAX_RESOLVED_ROLLUPS) {
      throw new Error(`resolved ${knownRollups.size} historical Rollup emitters; maximum is ${MAX_RESOLVED_ROLLUPS}`);
    }

    const logs = [];
    for (const rollupAddress of knownRollups) {
      const emitterLogs = await client.getLogs({
        address: rollupAddress,
        event: slashedEvent,
        fromBlock,
        toBlock,
        strict: true,
      });
      for (const log of emitterLogs) logs.push(normalizeSlashLog(log, rollupAddress));
    }
    logs.sort(compareLogs);

    // As with state snapshots, number-pinned calls are followed by a hash
    // check. A provider switching forks mid-range cannot advance the cursor.
    const verifiedCheckpoint = await client.getBlock({ blockNumber: toBlock });
    if (!verifiedCheckpoint.hash || verifiedCheckpoint.hash.toLowerCase() !== checkpointBlock.hash.toLowerCase()) {
      throw new Error(`confirmed L1 log checkpoint ${toBlock} changed during scan`);
    }

    return {
      chainId: this.chainId,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      toBlockHash: checkpointBlock.hash,
      confirmedBlockNumber: confirmedBlockNumber.toString(),
      reorgDetected,
      initial: cursorNumber === undefined,
      initialBackfill: cursorNumber === undefined || previous.metadata?.initialBackfill === true,
      hasMore: toBlock < confirmedBlockNumber,
      registryAddress: this.registryAddress,
      rollupAddresses: [...knownRollups].sort(),
      logs,
      observedAt: this.now(),
    };
  }

  async scanWithClient(client, previous = {}) {
    const actualChainId = await client.getChainId();
    if (actualChainId !== this.chainId) {
      throw new Error(`chain id ${actualChainId}, expected ${this.chainId}`);
    }

    const head = await client.getBlock({ blockTag: 'latest' });
    if (head.number === null || !head.hash) {
      throw new Error('latest L1 block has no number or hash');
    }
    this.assertFreshTimestamp(head.timestamp);
    if (head.number < this.confirmations) {
      throw new Error(`L1 head ${head.number} is below confirmation depth ${this.confirmations}`);
    }

    const blockNumber = head.number - this.confirmations;
    this.assertHeadProgress(head, previous, blockNumber);
    const block = this.confirmations === 0n
      ? head
      : await client.getBlock({ blockNumber });
    if (!block.hash) {
      throw new Error(`confirmed L1 block ${blockNumber} has no hash`);
    }

    const previousBlockNumber = readOptionalBigInt(previous.lastBlockNumber ?? previous.blockNumber);
    const previousBlockHash = previous.lastBlockHash ?? previous.blockHash;
    let reorgDetected = false;
    if (previousBlockNumber !== undefined && previousBlockHash) {
      if (blockNumber < previousBlockNumber) {
        throw new Error(`confirmed L1 head moved backwards from ${previousBlockNumber} to ${blockNumber}`);
      }
      const canonicalPrevious = blockNumber === previousBlockNumber
        ? block
        : await client.getBlock({ blockNumber: previousBlockNumber });
      reorgDetected = canonicalPrevious.hash?.toLowerCase() !== String(previousBlockHash).toLowerCase();
    }

    const codeAtRegistry = await client.getBytecode({ address: this.registryAddress, blockNumber });
    requireCode(codeAtRegistry, 'Registry', this.registryAddress);
    const rollupAddress = getAddress(await read(client, this.registryAddress, registryAbi, 'getCanonicalRollup', blockNumber));
    requireNonZero(rollupAddress, 'canonical Rollup');
    requireCode(await client.getBytecode({ address: rollupAddress, blockNumber }), 'Rollup', rollupAddress);

    const [
      rollupVersion,
      activeSlasherValue,
      legacySlasherValue,
      currentSlot,
      currentEpoch,
      l1GenesisTime,
      slotDuration,
      epochDuration,
    ] = await Promise.all([
      read(client, rollupAddress, rollupAbi, 'getVersion', blockNumber),
      read(client, rollupAddress, rollupAbi, 'getSlasher', blockNumber),
      read(client, rollupAddress, rollupAbi, 'getLegacySlasher', blockNumber),
      read(client, rollupAddress, rollupAbi, 'getCurrentSlot', blockNumber),
      read(client, rollupAddress, rollupAbi, 'getCurrentEpoch', blockNumber),
      read(client, rollupAddress, rollupAbi, 'getGenesisTime', blockNumber),
      read(client, rollupAddress, rollupAbi, 'getSlotDuration', blockNumber),
      read(client, rollupAddress, rollupAbi, 'getEpochDuration', blockNumber),
    ]);

    const activeSlasher = getAddress(activeSlasherValue);
    const legacySlasher = getAddress(legacySlasherValue[0]);
    requireNonZero(activeSlasher, 'active Slasher');

    const stackInputs = [{ role: 'active', slasherAddress: activeSlasher }];
    // A pending Slasher cannot execute and therefore is not a current risk
    // source. It becomes relevant only after the Rollup promotes it to active.
    if (legacySlasher !== zeroAddress && legacySlasherValue[1] >= block.timestamp) {
      stackInputs.push({
        role: 'legacy',
        slasherAddress: legacySlasher,
        authorizedUntil: legacySlasherValue[1].toString(),
      });
    }

    const uniqueStacks = deduplicateStacks(stackInputs);
    const stacks = [];
    const stackErrors = [];
    for (const input of uniqueStacks) {
      try {
        stacks.push(await this.scanStack(client, {
          ...input,
          rollupAddress,
          currentSlot,
          blockNumber,
        }));
      } catch (error) {
        // The active stack is the canonical safety signal and must be coherent.
        // A broken legacy stack is isolated and reported as degraded so
        // it cannot freeze active monitoring for its whole authorization window.
        if (input.role === 'active') throw error;
        stackErrors.push({
          role: input.role,
          slasherAddress: input.slasherAddress,
          error: sanitizeRpcError(error),
        });
      }
    }

    // Calls are number-pinned because broad EIP-1898 support is inconsistent.
    // Re-reading the chosen block closes the mixed-fork window: no state from a
    // replacement block is published under the hash captured at scan start.
    const verifiedBlock = await client.getBlock({ blockNumber });
    if (!verifiedBlock.hash || verifiedBlock.hash.toLowerCase() !== block.hash.toLowerCase()) {
      throw new Error(`confirmed L1 block ${blockNumber} changed during snapshot`);
    }

    return {
      chainId: this.chainId,
      blockNumber: blockNumber.toString(),
      blockHash: block.hash,
      blockTimestamp: block.timestamp.toString(),
      observedAt: this.now(),
      reorgDetected,
      registryAddress: this.registryAddress,
      rollupAddress,
      rollupVersion: rollupVersion.toString(),
      l1GenesisTime: l1GenesisTime.toString(),
      currentSlot: currentSlot.toString(),
      currentEpoch: currentEpoch.toString(),
      slotDuration: slotDuration.toString(),
      epochDuration: epochDuration.toString(),
      stacks,
      stackErrors,
      degraded: stackErrors.length > 0 || stacks.some((stack) => stack.roundErrors.length > 0),
    };
  }

  async scanStack(client, input) {
    const { role, slasherAddress, rollupAddress, currentSlot, blockNumber } = input;
    requireCode(await client.getBytecode({ address: slasherAddress, blockNumber }), `${role} Slasher`, slasherAddress);
    const proposerAddress = getAddress(await read(client, slasherAddress, slasherAbi, 'PROPOSER', blockNumber));
    requireNonZero(proposerAddress, `${role} SlashingProposer`);
    requireCode(await client.getBytecode({ address: proposerAddress, blockNumber }), `${role} SlashingProposer`, proposerAddress);

    const [
      proposerRollup,
      proposerSlasher,
      currentRound,
      quorum,
      roundSize,
      roundSizeInEpochs,
      executionDelayInRounds,
      lifetimeInRounds,
      slashOffsetInRounds,
      committeeSize,
      isSlashingEnabled,
      slashingDisabledUntil,
      slashingDisableDuration,
    ] = await Promise.all([
      read(client, proposerAddress, slashingProposerAbi, 'INSTANCE', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'SLASHER', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'getCurrentRound', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'QUORUM', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'ROUND_SIZE', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'ROUND_SIZE_IN_EPOCHS', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'EXECUTION_DELAY_IN_ROUNDS', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'LIFETIME_IN_ROUNDS', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'SLASH_OFFSET_IN_ROUNDS', blockNumber),
      read(client, proposerAddress, slashingProposerAbi, 'COMMITTEE_SIZE', blockNumber),
      read(client, slasherAddress, slasherAbi, 'isSlashingEnabled', blockNumber),
      read(client, slasherAddress, slasherAbi, 'slashingDisabledUntil', blockNumber),
      read(client, slasherAddress, slasherAbi, 'SLASHING_DISABLE_DURATION', blockNumber),
    ]);

    if (getAddress(proposerRollup) !== rollupAddress) {
      throw new Error(`${role} proposer INSTANCE does not match the canonical Rollup`);
    }
    if (getAddress(proposerSlasher) !== slasherAddress) {
      throw new Error(`${role} proposer SLASHER does not match its Slasher`);
    }

    const config = {
      quorum,
      roundSize,
      roundSizeInEpochs,
      executionDelayInRounds,
      lifetimeInRounds,
      slashOffsetInRounds,
      committeeSize,
    };
    let pauseStartedAtSlot = null;
    let pauseEndsAtSlot = null;
    if (!isSlashingEnabled && slashingDisabledUntil > 0n) {
      const pauseStartedAt = slashingDisabledUntil - slashingDisableDuration;
      [pauseStartedAtSlot, pauseEndsAtSlot] = await Promise.all([
        read(client, rollupAddress, rollupAbi, 'getSlotAt', blockNumber, [pauseStartedAt]),
        read(client, rollupAddress, rollupAbi, 'getSlotAt', blockNumber, [slashingDisabledUntil]),
      ]);
    }
    const firstRound = currentRound > lifetimeInRounds ? currentRound - lifetimeInRounds : 0n;
    const rounds = [];
    const roundErrors = [];
    for (let round = firstRound; round <= currentRound; round += 1n) {
      try {
        const scanned = await scanRound(client, {
          proposerAddress,
          slasherAddress,
          blockNumber,
          round,
          currentRound,
          currentSlot,
          config,
          isSlashingEnabled,
        });
        if (scanned.ballotCount !== '0' || scanned.isExecuted || scanned.actions.length > 0) {
          rounds.push(scanned);
        }
      } catch (error) {
        roundErrors.push({ round: round.toString(), error: sanitizeRpcError(error) });
      }
    }

    return {
      role,
      slasherAddress,
      proposerAddress,
      ...(input.readyAt ? { readyAt: input.readyAt } : {}),
      ...(input.authorizedUntil ? { authorizedUntil: input.authorizedUntil } : {}),
      currentRound: currentRound.toString(),
      isSlashingEnabled,
      slashingDisabledUntil: slashingDisabledUntil.toString(),
      slashingDisableDuration: slashingDisableDuration.toString(),
      pauseStartedAtSlot: pauseStartedAtSlot?.toString() ?? null,
      pauseEndsAtSlot: pauseEndsAtSlot?.toString() ?? null,
      parameters: {
        quorum: quorum.toString(),
        roundSize: roundSize.toString(),
        roundSizeInEpochs: roundSizeInEpochs.toString(),
        executionDelayInRounds: executionDelayInRounds.toString(),
        lifetimeInRounds: lifetimeInRounds.toString(),
        slashOffsetInRounds: slashOffsetInRounds.toString(),
        committeeSize: committeeSize.toString(),
      },
      rounds,
      roundErrors,
    };
  }

  assertFreshTimestamp(timestamp) {
    const blockMs = Number(timestamp) * 1_000;
    const now = this.now();
    if (blockMs + this.maxHeadAgeMs < now) {
      throw new Error(`L1 head is ${now - blockMs}ms old`);
    }
    if (blockMs > now + this.maxFutureSkewMs) {
      throw new Error(`L1 head timestamp is ${blockMs - now}ms in the future`);
    }
  }

  assertHeadProgress(head, previous, confirmedBlockNumber) {
    const previousBlockNumber = readOptionalBigInt(previous?.lastBlockNumber ?? previous?.blockNumber);
    if (previousBlockNumber === undefined || previousBlockNumber !== confirmedBlockNumber) return;
    const stalledForMs = this.now() - Number(head.timestamp) * 1_000;
    if (stalledForMs > this.maxHeadStallMs) {
      throw new Error(
        `L1 confirmed head ${confirmedBlockNumber} has not advanced for ${stalledForMs}ms ` +
        `(limit ${this.maxHeadStallMs}ms)`,
      );
    }
  }
}

export async function scanRound(client, input) {
  const {
    proposerAddress,
    slasherAddress,
    blockNumber,
    round,
    currentRound,
    currentSlot,
    config,
    isSlashingEnabled,
  } = input;
  const roundResult = await read(client, proposerAddress, slashingProposerAbi, 'getRound', blockNumber, [round]);
  const [isExecuted, ballotCount] = roundResult;
  let committees = [];
  let actions = [];
  let payloadAddress = null;
  let isVetoed = false;

  const targetEpochs = [];
  if (round >= config.slashOffsetInRounds) {
    const startEpoch = (round - config.slashOffsetInRounds) * config.roundSizeInEpochs;
    for (let offset = 0n; offset < config.roundSizeInEpochs; offset += 1n) {
      targetEpochs.push((startEpoch + offset).toString());
    }
  }

  // Below quorum, a ballot count is not validator-specific evidence. Avoid the
  // committee and per-vote reads entirely; they were expensive and produced
  // noisy "first vote" alerts that could not claim a slash candidate existed.
  if (isExecuted || ballotCount >= config.quorum) {
    committees = await read(
      client,
      proposerAddress,
      slashingProposerAbi,
      'getSlashTargetCommittees',
      blockNumber,
      [round],
    );
    const result = await read(client, proposerAddress, slashingProposerAbi, 'getTally', blockNumber, [round, committees]);
    actions = annotateSlashActions(result, committees, targetEpochs);
    if (actions.length > 0) {
      const contractActions = actions.map((action) => ({ validator: action.validator, slashAmount: BigInt(action.amount) }));
      payloadAddress = getAddress(await read(
        client,
        proposerAddress,
        slashingProposerAbi,
        'getPayloadAddress',
        blockNumber,
        [round, contractActions],
      ));
      isVetoed = await read(client, slasherAddress, slasherAbi, 'vetoedPayloads', blockNumber, [payloadAddress]);
    }
  }

  const executableSlot = (round + 1n + config.executionDelayInRounds) * config.roundSize;
  const expirySlot = (round + 1n + config.lifetimeInRounds) * config.roundSize;
  const proposerStatus = calculateStatus({
    round,
    currentRound,
    currentSlot,
    isExecuted,
    isVetoed,
    hasActions: actions.length > 0,
    executableSlot,
    lifetimeInRounds: config.lifetimeInRounds,
    executionDelayInRounds: config.executionDelayInRounds,
  });
  const status = proposerStatus;
  const isExecutionPaused = !isSlashingEnabled && !isExecuted;

  return {
    round: round.toString(),
    ballotCount: ballotCount.toString(),
    isExecuted,
    status,
    actions,
    payloadAddress,
    isVetoed,
    executableSlot: executableSlot.toString(),
    expirySlot: expirySlot.toString(),
    targetEpochs,
    isAuthorized: true,
    proposerStatus,
    isExecutionPaused,
  };
}

export function annotateSlashActions(rawActions, committees, targetEpochs) {
  const flattened = [];
  for (let epochIndex = 0; epochIndex < committees.length; epochIndex += 1) {
    const committee = committees[epochIndex] ?? [];
    for (let committeeIndex = 0; committeeIndex < committee.length; committeeIndex += 1) {
      flattened.push({
        address: getAddress(committee[committeeIndex]).toLowerCase(),
        epochIndex,
        committeeIndex,
        epoch: targetEpochs[epochIndex] ?? null,
      });
    }
  }

  let cursor = 0;
  return rawActions.map((action, actionIndex) => {
    const validator = getAddress(action.validator).toLowerCase();
    let provenance = null;
    for (let index = cursor; index < flattened.length; index += 1) {
      if (flattened[index].address !== validator) continue;
      provenance = flattened[index];
      cursor = index + 1;
      break;
    }
    return {
      validator,
      amount: action.slashAmount.toString(),
      actionIndex,
      epoch: provenance?.epoch ?? null,
      epochIndex: provenance?.epochIndex ?? null,
      committeeIndex: provenance?.committeeIndex ?? null,
    };
  });
}

export function calculateStatus(input) {
  if (input.isExecuted) return 'executed';
  if (input.isVetoed && input.currentRound > input.round) return 'vetoed';
  if (!input.hasActions) {
    return input.currentRound > input.round ? 'no-consensus' : 'below-quorum';
  }
  if (input.currentRound > input.round + input.lifetimeInRounds) return 'expired';
  const isPastDelay = input.currentRound > input.round + input.executionDelayInRounds;
  if (isPastDelay && input.currentSlot >= input.executableSlot) {
    return input.currentRound === input.round + input.executionDelayInRounds + 1n
      ? 'newly-executable'
      : 'executable';
  }
  return 'quorum-reached';
}

async function read(client, address, abi, functionName, blockNumber, args = []) {
  return client.readContract({ address, abi, functionName, args, blockNumber });
}

export function deduplicateStacks(stacks) {
  const bySlasher = new Map();
  const rolePriority = { active: 2, legacy: 1 };
  for (const stack of stacks) {
    if (!(stack.role in rolePriority)) continue;
    const key = stack.slasherAddress.toLowerCase();
    const existing = bySlasher.get(key);
    if (!existing) {
      bySlasher.set(key, { ...stack });
      continue;
    }

    // The same contract can be both active and still listed as legacy during a
    // rotation boundary. Scan it once and prefer the active role.
    const preferred = (rolePriority[stack.role] ?? 0) > (rolePriority[existing.role] ?? 0)
      ? stack
      : existing;
    bySlasher.set(key, { ...existing, ...stack, ...preferred });
  }
  return [...bySlasher.values()];
}

function requireNonZero(address, label) {
  if (address === zeroAddress) throw new Error(`${label} address is zero`);
}

function requireCode(code, label, address) {
  if (!code || code === '0x') throw new Error(`no contract code at ${label} ${address}`);
}

function readOptionalBigInt(value) {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function normalizeSlashLog(log, expectedEmitter) {
  const blockNumber = readOptionalBigInt(log.blockNumber);
  const logIndex = typeof log.logIndex === 'bigint' ? Number(log.logIndex) : log.logIndex;
  if (
    blockNumber === undefined ||
    !Number.isSafeInteger(logIndex) ||
    logIndex < 0 ||
    !/^0x[0-9a-fA-F]{64}$/.test(String(log.blockHash ?? '')) ||
    !/^0x[0-9a-fA-F]{64}$/.test(String(log.transactionHash ?? ''))
  ) {
    throw new Error('Slashed log is missing its block/transaction identity');
  }
  if (log.removed) throw new Error('RPC returned a removed Slashed log from a confirmed range');
  const emitter = getAddress(log.address ?? expectedEmitter).toLowerCase();
  if (emitter !== expectedEmitter.toLowerCase()) {
    throw new Error('RPC returned a Slashed log from an unrequested emitter');
  }
  if (!log.args?.attester || log.args.amount === undefined) {
    throw new Error('Slashed log is missing attester or amount');
  }
  const amount = BigInt(log.args.amount);
  if (amount < 0n) throw new Error('Slashed log amount is negative');
  return {
    rollupAddress: emitter,
    blockNumber: blockNumber.toString(),
    blockHash: log.blockHash.toLowerCase(),
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex,
    validator: getAddress(log.args.attester).toLowerCase(),
    amount: amount.toString(),
  };
}

function compareLogs(left, right) {
  const blockOrder = BigInt(left.blockNumber) < BigInt(right.blockNumber)
    ? -1
    : BigInt(left.blockNumber) > BigInt(right.blockNumber) ? 1 : 0;
  return blockOrder || left.logIndex - right.logIndex ||
    left.transactionHash.localeCompare(right.transactionHash);
}

function minBigInt(left, right) {
  return left < right ? left : right;
}

function addResolvedRollup(target, value) {
  const address = getAddress(value);
  if (address !== zeroAddress) target.add(address.toLowerCase());
}

function sanitizeRpcError(error) {
  const message = error?.shortMessage ?? error?.message ?? String(error);
  return String(message)
    .replace(/https?:\/\/[^\s)]+/gi, '[rpc]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}
