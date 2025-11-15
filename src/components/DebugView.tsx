import React, { useState } from 'react';
import { useSlashingStore } from '../store/slashingStore';
import { formatEther } from 'viem';

export const DebugView: React.FC = () => {
  const [customRpcUrl, setCustomRpcUrl] = useState<string>('');
  const { config, currentRound, currentSlot, currentEpoch, isSlashingEnabled, slashingDisabledUntil, slashingDisableDuration, activeAttesterCount, entryQueueLength, stats, updateRpcUrl } = useSlashingStore();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const clearAllCache = () => {
    // Clear all localStorage
    localStorage.clear();

    console.log('All localStorage cleared. Reloading page to clear in-memory caches...');

    // Reload the page to clear all in-memory caches
    // (ImmutableAwareCache instances, Zustand store, etc.)
    window.location.reload();
  };

  const handleRpcUrlChange = () => {
    if (!customRpcUrl.trim()) {
      alert('Please enter a valid RPC URL');
      return;
    }
    updateRpcUrl(customRpcUrl.trim());
  };

  const handleResetRpcUrl = () => {
    localStorage.removeItem('customL1RpcUrl');
    console.log('Custom RPC URL removed. Reloading page...');
    window.location.reload();
  };

  if (!config) {
    return (
      <div className="bg-lapis border-5 border-aqua p-8 shadow-brutal-aqua">
        <div className="text-aqua font-black uppercase text-xl">Loading configuration...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-lapis border-5 border-aqua p-6 shadow-brutal-aqua">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <svg className="w-10 h-10 text-aqua stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          Contract Parameters
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ConfigItem label="TallyProposer.QUORUM()" value={config.quorum?.toString() || 'Not loaded'} />
          <ConfigItem label="TallyProposer.ROUND_SIZE()" value={config.slashingRoundSize?.toString() || 'Not loaded'} />
          <ConfigItem label="TallyProposer.ROUND_SIZE_IN_EPOCHS()" value={config.slashingRoundSizeInEpochs?.toString() || 'Not loaded'} />
          <ConfigItem label="TallyProposer.EXECUTION_DELAY_IN_ROUNDS()" value={config.executionDelayInRounds?.toString() || 'Not loaded'} />
          <ConfigItem label="TallyProposer.LIFETIME_IN_ROUNDS()" value={config.lifetimeInRounds?.toString() || 'Not loaded'} />
          <ConfigItem label="TallyProposer.SLASH_OFFSET_IN_ROUNDS()" value={config.slashOffsetInRounds?.toString() || 'Not loaded'} />
          <ConfigItem label="TallyProposer.COMMITTEE_SIZE()" value={config.committeeSize?.toString() || 'Not loaded'} />
          <ConfigItem label="Rollup.getSlotDuration()" value={config.slotDuration ? `${config.slotDuration}s` : 'Not loaded'} />
          <ConfigItem label="Rollup.getEpochDuration()" value={config.epochDuration ? `${config.epochDuration}s` : 'Not loaded'} />
          <ConfigItem label="Slasher.SLASHING_DISABLE_DURATION()" value={slashingDisableDuration ? `${slashingDisableDuration}s` : 'Not loaded'} />
        </div>
      </section>

      {/* Current Chain State */}
      <section className="bg-lapis border-5 border-aqua p-6 shadow-brutal-aqua">
        <h3 className="text-2xl font-black mb-5 text-aqua uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
          Current Chain State
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StateCard label="TallyProposer.getCurrentRound()" value={currentRound?.toString() || 'Not loaded'} />
          <StateCard label="Rollup.getCurrentSlot()" value={currentSlot?.toString() || 'Not loaded'} />
          <StateCard label="Rollup.getCurrentEpoch()" value={currentEpoch?.toString() || 'Not loaded'} />
          <StateCard
            label="Slasher.isSlashingEnabled()"
            value={isSlashingEnabled ? 'YES' : 'NO'}
            highlight={isSlashingEnabled}
          />
          <StateCard
            label="Slasher.slashingDisabledUntil()"
            value={slashingDisabledUntil ? new Date(Number(slashingDisabledUntil) * 1000).toLocaleString() : 'N/A'}
            wide
          />
          <StateCard
            label="Rollup.getActiveAttesterCount()"
            value={activeAttesterCount?.toString() || 'Not loaded'}
            highlight={activeAttesterCount === 0n}
          />
          <StateCard
            label="Rollup.getEntryQueueLength()"
            value={entryQueueLength?.toString() || 'Not loaded'}
          />
        </div>
      </section>

      {/* RPC Configuration */}
      <section className="bg-aubergine border-5 border-orchid p-6 shadow-brutal-orchid">
        <h3 className="text-2xl font-black mb-5 text-orchid uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
          </svg>
          RPC Configuration
        </h3>
        <div className="space-y-4">
          <div className="bg-brand-black border-3 border-orchid/50 p-4">
            <div className="text-sm text-whisper-white mb-3">
              <span className="font-black uppercase text-orchid">Current RPC URL: </span>
              <span className="font-mono text-xs break-all">
                {Array.isArray(config.l1RpcUrl) ? config.l1RpcUrl.join(', ') : config.l1RpcUrl}
              </span>
              {localStorage.getItem('customL1RpcUrl') && (
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
                  className="w-full bg-brand-black border-3 border-whisper-white/30 px-4 py-3 text-whisper-white font-mono text-sm focus:border-orchid focus:outline-none"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleRpcUrlChange();
                    }
                  }}
                />
              </div>
              <button
                onClick={handleRpcUrlChange}
                className="bg-orchid hover:bg-orchid/90 text-brand-black border-5 border-brand-black px-6 py-3 shadow-brutal hover:-translate-y-1 hover:translate-x-1 hover:shadow-none transition-all duration-100 cursor-pointer"
              >
                <span className="text-sm font-bold uppercase tracking-wider">Update RPC</span>
              </button>
              {localStorage.getItem('customL1RpcUrl') && (
                <button
                  onClick={handleResetRpcUrl}
                  className="bg-brand-black border-5 border-orchid px-6 py-3 shadow-brutal-orchid hover:-translate-y-1 hover:translate-x-1 hover:shadow-none transition-all duration-100 cursor-pointer"
                >
                  <span className="text-sm font-bold uppercase tracking-wider text-orchid">Reset to Default</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Cache Management */}
      <section className="bg-oxblood border-5 border-vermillion p-6 shadow-brutal-vermillion">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-7 h-7 text-vermillion stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
            <h3 className="text-2xl font-black text-vermillion uppercase">Cache Management</h3>
          </div>
          <button
            onClick={clearAllCache}
            className="bg-brand-black border-5 border-vermillion px-6 py-3 shadow-brutal-vermillion hover:-translate-y-1 hover:translate-x-1 hover:shadow-none transition-all duration-100 cursor-pointer"
            aria-label="Clear all caches and reload"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-vermillion stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
              <span className="text-sm font-bold uppercase tracking-wider text-vermillion">
                Clear Cache & Reload
              </span>
            </div>
          </button>
        </div>
      </section>

      {/* Aggregated Statistics */}
      <section className="bg-oxblood border-5 border-vermillion p-6 shadow-brutal-vermillion">
        <h3 className="text-2xl font-black mb-5 text-vermillion uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          Environment Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ConfigItem label="L1 RPC URL" value={Array.isArray(config.l1RpcUrl) ? config.l1RpcUrl.join(', ') : config.l1RpcUrl} />
          <ConfigItem label="Tally Proposer Address" value={config.tallySlashingProposerAddress} copyable />
          <ConfigItem label="Slasher Address" value={config.slasherAddress} copyable />
          <ConfigItem label="Rollup Address" value={config.rollupAddress} copyable />
          <ConfigItem label="Node Admin URL" value={config.nodeAdminUrl || 'Not configured'} />
          <ConfigItem label="L2 Poll Interval" value={`${config.l2PollInterval}ms`} />
          <ConfigItem label="Countdown Interval" value={`${config.realtimeCountdownInterval}ms`} />
          <ConfigItem label="Round Cache TTL" value={`${config.l1RoundCacheTTL}ms`} />
          <ConfigItem label="Details Cache TTL" value={`${config.detailsCacheTTL}ms`} />
        </div>
      </section>
    </div>
  );
};

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
            onClick={handleCopy}
            className="text-xs px-3 py-1 bg-chartreuse hover:bg-chartreuse/90 text-brand-black border-3 border-brand-black font-black uppercase flex-shrink-0"
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
