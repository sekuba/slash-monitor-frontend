import React, { useState } from 'react';
import { useSlashingStore } from '../store/slashingStore';
import { formatEther } from 'viem';
import { getCustomRpcUrl } from '@/lib/rpcOverride';
import type { MonitorConfigInput } from '@/types/slashing';

interface DebugViewProps {
  configInput: MonitorConfigInput;
  onResetRpc: () => void;
  onUpdateRpc: (url: string) => void;
}

export const DebugView: React.FC<DebugViewProps> = ({ configInput, onResetRpc, onUpdateRpc }) => {
  const [customRpcUrl, setCustomRpcUrl] = useState<string>('');
  const [rpcNotice, setRpcNotice] = useState<string | null>(null);
  const { config, isInitialized, initializationError, l1BlockNumber, l1Timestamp, currentRound, currentSlot, currentEpoch, isSlashingEnabled, slashingDisabledUntil, slashingDisableDuration, stats, audit } = useSlashingStore();
  const customRpcOverride = getCustomRpcUrl(configInput.chainId);
  const notInitialized = 'Not initialized';

  const handleRpcUrlChange = () => {
    if (!customRpcUrl.trim()) {
      setRpcNotice('Enter an RPC URL before starting a new scanner attempt.');
      return;
    }
    onUpdateRpc(customRpcUrl.trim());
    setCustomRpcUrl('');
    setRpcNotice('Custom RPC saved. A fresh client scanner attempt has started.');
  };

  const handleResetRpcUrl = () => {
    onResetRpc();
    setRpcNotice('Custom RPC cleared. A fresh client scanner attempt has started.');
  };

  return (
    <div className="space-y-6">
      <div className="bg-lapis border-5 border-aqua p-6 shadow-brutal-aqua">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <svg className="w-10 h-10 text-aqua stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
            </svg>
            <h2 className="text-3xl font-black text-aqua uppercase">Contract Debug View</h2>
          </div>
          <div className="text-sm font-bold text-whisper-white uppercase">
            {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Contract Parameters */}
      <section className="bg-aubergine border-5 border-orchid p-6 shadow-brutal-orchid">
        <h3 className="text-2xl font-black mb-5 text-orchid uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          Contract Parameters
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ConfigItem label="SlashingProposer.QUORUM()" value={config?.quorum?.toString() ?? notInitialized} />
          <ConfigItem label="SlashingProposer.ROUND_SIZE()" value={config?.slashingRoundSize?.toString() ?? notInitialized} />
          <ConfigItem label="SlashingProposer.ROUND_SIZE_IN_EPOCHS()" value={config?.slashingRoundSizeInEpochs?.toString() ?? notInitialized} />
          <ConfigItem label="SlashingProposer.EXECUTION_DELAY_IN_ROUNDS()" value={config?.executionDelayInRounds?.toString() ?? notInitialized} />
          <ConfigItem label="SlashingProposer.LIFETIME_IN_ROUNDS()" value={config?.lifetimeInRounds?.toString() ?? notInitialized} />
          <ConfigItem label="SlashingProposer.SLASH_OFFSET_IN_ROUNDS()" value={config?.slashOffsetInRounds?.toString() ?? notInitialized} />
          <ConfigItem label="SlashingProposer.COMMITTEE_SIZE()" value={config?.committeeSize?.toString() ?? notInitialized} />
          <ConfigItem label="Rollup.getSlotDuration()" value={config ? `${config.slotDuration}s` : notInitialized} />
          <ConfigItem label="Rollup.getEpochDuration()" value={config ? `${config.epochDuration} slots` : notInitialized} />
          <ConfigItem label="Slasher.SLASHING_DISABLE_DURATION()" value={isInitialized ? `${slashingDisableDuration}s` : notInitialized} />
        </div>
      </section>

      {/* Current Chain State */}
      <section className="bg-lapis border-5 border-aqua p-6 shadow-brutal-aqua">
        <h3 className="text-2xl font-black mb-5 text-aqua uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
          Current Chain State
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StateCard label="SlashingProposer.getCurrentRound()" value={isInitialized ? currentRound.toString() : notInitialized} />
          <StateCard label="L1 Snapshot Block" value={isInitialized ? l1BlockNumber.toString() : notInitialized} />
          <StateCard label="L1 Snapshot Time" value={isInitialized ? new Date(Number(l1Timestamp) * 1000).toLocaleString() : notInitialized} />
          <StateCard label="Rollup.getCurrentSlot()" value={isInitialized ? currentSlot.toString() : notInitialized} />
          <StateCard label="Rollup.getCurrentEpoch()" value={isInitialized ? currentEpoch.toString() : notInitialized} />
          <StateCard
            label="Slasher.isSlashingEnabled()"
            value={isInitialized ? (isSlashingEnabled ? 'YES' : 'NO') : notInitialized}
            highlight={isInitialized ? isSlashingEnabled : undefined}
          />
          <StateCard
            label="Slasher.slashingDisabledUntil()"
            value={isInitialized
              ? (slashingDisabledUntil > 0n ? new Date(Number(slashingDisabledUntil) * 1000).toLocaleString() : 'N/A')
              : notInitialized}
            wide
          />
        </div>
      </section>

      <section className="bg-oxblood border-5 border-vermillion p-6 shadow-brutal-vermillion">
        <h3 className="text-2xl font-black mb-5 text-vermillion uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          Audit Status
        </h3>
        <div className="space-y-3">
          <StateCard
            label="Latest Scan"
            value={debugScanLabel(isInitialized, initializationError, audit.status)}
            highlight={isInitialized ? audit.status === 'ok' : undefined}
            wide
          />
          <StateCard
            label="Last Verified Scan"
            value={audit.lastSuccessfulAt === null ? 'Never' : new Date(audit.lastSuccessfulAt).toLocaleString()}
            highlight={audit.lastSuccessfulAt !== null}
            wide
          />
          {audit.issues.length > 0 && (
            <div className="bg-brand-black border-3 border-vermillion p-4 space-y-2">
              {audit.issues.map((issue, index) => (
                <div key={`${issue.scope}-${issue.round?.toString() ?? 'global'}-${index}`} className="text-sm font-bold text-whisper-white">
                  [{issue.scope}]
                  {issue.round !== undefined ? ` round ${issue.round.toString()}: ` : ' '}
                  {issue.message}
                </div>
              ))}
            </div>
          )}
          {initializationError && (
            <div className="bg-brand-black border-3 border-vermillion p-4 text-sm font-bold text-whisper-white" role="alert">
              {initializationError}
            </div>
          )}
        </div>
      </section>

      {/* RPC Configuration */}
      <section className="bg-aubergine border-5 border-orchid p-6 shadow-brutal-orchid">
        <h3 className="text-2xl font-black mb-5 text-orchid uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
          </svg>
          RPC Configuration
        </h3>
        <div className="space-y-4">
          <div className="bg-brand-black border-3 border-orchid/50 p-4">
            <div className="text-sm text-whisper-white mb-3">
              <span className="font-black uppercase text-orchid">Current RPC URL: </span>
              <span className="font-mono text-xs break-all">
                {Array.isArray(configInput.l1RpcUrl) ? configInput.l1RpcUrl.join(', ') || 'Not configured' : configInput.l1RpcUrl || 'Not configured'}
              </span>
              {customRpcOverride && (
                <span className="ml-3 px-2 py-1 bg-chartreuse text-brand-black text-xs font-black uppercase">CUSTOM</span>
              )}
            </div>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs font-black uppercase text-orchid mb-2">
                  New RPC URL
                </label>
                <input
                  type="text"
                  value={customRpcUrl}
                  onChange={(e) => setCustomRpcUrl(e.target.value)}
                  placeholder="https://eth-mainnet.g.alchemy.com/v2/..."
                  className="w-full bg-brand-black border-3 border-whisper-white/30 px-4 py-3 text-whisper-white font-mono text-sm focus:border-orchid focus:outline-hidden"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleRpcUrlChange();
                    }
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleRpcUrlChange}
                className="brutal-button brutal-button--orchid brutal-button--lg"
              >
                <span className="text-sm font-bold uppercase tracking-wider">Update RPC</span>
              </button>
              {customRpcOverride && (
                <button
                  type="button"
                  onClick={handleResetRpcUrl}
                  className="brutal-button brutal-button--outline-orchid brutal-button--lg"
                >
                  <span className="text-sm font-bold uppercase tracking-wider text-orchid">Reset to Default</span>
                </button>
              )}
            </div>
            {rpcNotice && <p className="mt-3 text-sm font-bold text-aqua" role="status">{rpcNotice}</p>}
          </div>
        </div>
      </section>

      {/* Aggregated Statistics */}
      <section className="bg-oxblood border-5 border-vermillion p-6 shadow-brutal-vermillion">
        <h3 className="text-2xl font-black mb-5 text-vermillion uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
          </svg>
          Aggregated Statistics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Monitored Rounds" value={stats.totalRoundsMonitored} />
          <StatCard label="Active" value={stats.activeSlashings} color="warn" />
          <StatCard label="Vetoed" value={stats.vetoedPayloads} color="orchid" />
          <StatCard label="Executed" value={stats.executedRounds} color="success" />
          <StatCard label="Sequencers Hit" value={stats.totalValidatorsSlashed} color="warn" />
          <StatCard label="Total Slash" value={`${formatEther(stats.totalSlashAmount)} AZTEC`} color="warn" wide />
        </div>
      </section>

      {/* Environment Configuration */}
      <section className="bg-malachite border-5 border-chartreuse p-6 shadow-brutal-chartreuse">
        <h3 className="text-2xl font-black mb-5 text-chartreuse uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          Environment Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ConfigItem label="L1 RPC URL" value={Array.isArray(configInput.l1RpcUrl) ? configInput.l1RpcUrl.join(', ') || 'Not configured' : configInput.l1RpcUrl || 'Not configured'} />
          <ConfigItem label="Registry Address" value={configInput.registryAddress} copyable />
          <ConfigItem label="Rollup Address" value={config?.rollupAddress ?? notInitialized} copyable={Boolean(config)} />
          <ConfigItem label="Rollup Version" value={config?.rollupVersion.toString() ?? notInitialized} />
          <ConfigItem label="Slasher Address" value={config?.slasherAddress ?? notInitialized} copyable={Boolean(config)} />
          <ConfigItem label="Slashing Proposer Address" value={config?.slashingProposerAddress ?? notInitialized} copyable={Boolean(config)} />
          <ConfigItem label="Pending Slasher" value={config?.pendingSlasherAddress ?? notInitialized} copyable={Boolean(config)} />
          <ConfigItem label="Pending Slashing Proposer" value={config?.pendingSlashingProposerAddress ?? notInitialized} copyable={Boolean(config)} />
          <ConfigItem label="Pending Slasher Ready At" value={!config ? notInitialized : config.pendingSlasherReadyAt === 0n ? 'None' : new Date(Number(config.pendingSlasherReadyAt) * 1000).toISOString()} />
          <ConfigItem label="Legacy Slasher" value={config?.legacySlasherAddress ?? notInitialized} copyable={Boolean(config)} />
          <ConfigItem label="Legacy Slashing Proposer" value={config?.legacySlashingProposerAddress ?? notInitialized} copyable={Boolean(config)} />
          <ConfigItem label="Legacy Authorized Until" value={!config ? notInitialized : config.legacySlasherAuthorizedUntil === 0n ? 'None' : new Date(Number(config.legacySlasherAuthorizedUntil) * 1000).toISOString()} />
          <ConfigItem label="Poll Interval" value={`${configInput.pollInterval}ms`} />
          <ConfigItem label="Countdown Interval" value={`${configInput.realtimeCountdownInterval}ms`} />
        </div>
      </section>
    </div>
  );
};

export function debugScanLabel(
  isInitialized: boolean,
  initializationError: string | null,
  auditStatus: 'ok' | 'partial' | 'stale' | 'fatal',
): string {
  if (!isInitialized) {
    return initializationError ? 'INITIALIZATION FAILED' : 'NOT INITIALIZED';
  }
  return {
    ok: 'FULLY VERIFIED',
    partial: 'PARTIAL COVERAGE',
    stale: 'STALE',
    fatal: 'UNAVAILABLE',
  }[auditStatus];
}

// Helper Components

interface ConfigItemProps {
  label: string;
  value: string;
  copyable?: boolean;
}

const ConfigItem: React.FC<ConfigItemProps> = ({ label, value, copyable }) => {
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
  };

  return (
    <div className="bg-brand-black border-3 border-whisper-white/20 p-3">
      <div className="text-xs text-whisper-white/60 mb-2 font-bold uppercase">{label}</div>
      <div className="flex items-center gap-2">
        <div className="text-sm font-bold text-whisper-white flex-1 truncate font-mono" title={value}>
          {value}
        </div>
        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className="brutal-button brutal-button--sm shrink-0"
          >
            Copy
          </button>
        )}
      </div>
    </div>
  );
};

interface StateCardProps {
  label: string;
  value: string;
  highlight?: boolean;
  wide?: boolean;
}

const StateCard: React.FC<StateCardProps> = ({ label, value, highlight, wide }) => {
  return (
    <div className={`bg-brand-black border-3 p-4 ${wide ? 'md:col-span-2' : ''} ${
      highlight !== undefined
        ? highlight
          ? 'border-chartreuse'
          : 'border-vermillion'
        : 'border-aqua'
    }`}>
      <div className="text-xs text-whisper-white/60 mb-2 font-bold uppercase">{label}</div>
      <div className={`text-xl font-black uppercase ${
        highlight !== undefined
          ? highlight
            ? 'text-chartreuse'
            : 'text-vermillion'
          : 'text-aqua'
      }`}>
        {value}
      </div>
    </div>
  );
};

interface StatCardProps {
  label: string;
  value: number | string;
  color?: 'warn' | 'success' | 'orchid';
  wide?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, color, wide }) => {
  const colorClasses = {
    warn: 'border-vermillion text-vermillion',
    success: 'border-chartreuse text-chartreuse',
    orchid: 'border-orchid text-orchid',
  };

  return (
    <div className={`bg-brand-black border-3 p-4 ${wide ? 'md:col-span-2' : ''} ${
      color ? colorClasses[color] : 'border-whisper-white text-whisper-white'
    }`}>
      <div className="text-xs text-whisper-white/60 mb-2 font-bold uppercase">{label}</div>
      <div className="text-2xl font-black uppercase">{value}</div>
    </div>
  );
};
