import React, { useState } from 'react';
import { useSlashingStore } from '../store/slashingStore';
import { formatEther } from 'viem';

export const DebugView: React.FC = () => {
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set());
  const { config, currentRound, currentSlot, currentEpoch, isSlashingEnabled, slashingDisabledUntil, slashingDisableDuration, detectedSlashings, stats } = useSlashingStore();

  const toggleRound = (round: string) => {
    const newExpanded = new Set(expandedRounds);
    if (newExpanded.has(round)) {
      newExpanded.delete(round);
    } else {
      newExpanded.add(round);
    }
    setExpandedRounds(newExpanded);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (!config) {
    return (
      <div className="bg-lapis border-5 border-aqua p-8 shadow-brutal-aqua">
        <div className="text-aqua font-black uppercase text-xl">Loading configuration...</div>
      </div>
    );
  }

  const slashingArray = Array.from(detectedSlashings.values()).sort((a, b) => Number(b.round - a.round));

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
          <ConfigItem label="Max Executed Rounds" value={config.maxExecutedRoundsToShow.toString()} />
          <ConfigItem label="Max Rounds to Scan" value={config.maxRoundsToScanForHistory.toString()} />
        </div>
      </section>

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
          <StatCard label="Validators Hit" value={stats.totalValidatorsSlashed} color="warn" />
          <StatCard label="Total Slash" value={`${formatEther(stats.totalSlashAmount)} ETH`} color="warn" wide />
        </div>
      </section>

      {/* Per-Round Detailed Data */}
      <section className="bg-brand-black border-5 border-whisper-white p-6 shadow-brutal">
        <h3 className="text-2xl font-black mb-5 text-whisper-white uppercase flex items-center gap-3">
          <svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
          </svg>
          Per-Round Contract Data ({slashingArray.length} rounds)
        </h3>
        <div className="space-y-4">
          {slashingArray.length === 0 && (
            <div className="bg-malachite/30 border-5 border-brand-black p-8 text-center">
              <div className="text-whisper-white/60 font-black uppercase text-lg">No slashing rounds detected</div>
            </div>
          )}
          {slashingArray.map((slashing) => {
            const roundStr = slashing.round.toString();
            const isExpanded = expandedRounds.has(roundStr);
            return (
              <div key={roundStr} className="bg-lapis border-5 border-aqua shadow-brutal-aqua overflow-hidden">
                <button
                  onClick={() => toggleRound(roundStr)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-aqua/10 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-xl font-black text-aqua">ROUND {roundStr}</span>
                    <span className={`px-3 py-1 border-3 text-xs font-black ${getStatusStyles(slashing.status)}`}>
                      {slashing.status.toUpperCase().replace(/-/g, ' ')}
                    </span>
                    {slashing.isVetoed && (
                      <span className="px-3 py-1 border-3 border-orchid bg-aubergine text-orchid text-xs font-black">
                        VETOED
                      </span>
                    )}
                    {slashing.isExecuted && (
                      <span className="px-3 py-1 border-3 border-chartreuse bg-malachite text-chartreuse text-xs font-black">
                        EXECUTED
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-6 text-sm font-bold text-whisper-white uppercase">
                    <span>Votes: {slashing.voteCount.toString()}</span>
                    {slashing.affectedValidatorCount !== undefined && (
                      <span>Validators: {slashing.affectedValidatorCount}</span>
                    )}
                    {slashing.totalSlashAmount !== undefined && (
                      <span className="text-vermillion">{formatEther(slashing.totalSlashAmount)} ETH</span>
                    )}
                    <span className="text-aqua text-xl">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-6 pb-6 space-y-4 bg-brand-black/30">
                    {/* Basic Round Data */}
                    <div className="bg-brand-black border-3 border-whisper-white/30 p-4">
                      <h4 className="font-black mb-3 text-whisper-white uppercase text-sm flex items-center gap-2">
                        <svg className="w-4 h-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        Round State
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                        <DataItem label="TallyProposer.getRound().voteCount" value={slashing.voteCount.toString()} />
                        <DataItem label="TallyProposer.getRound().isExecuted" value={slashing.isExecuted ? 'true' : 'false'} />
                        <DataItem label="Slasher.vetoedPayloads()" value={slashing.isVetoed ? 'true' : 'false'} />
                        <DataItem label="Computed Status" value={slashing.status} />
                        {slashing.slotWhenExecutable !== undefined && (
                          <DataItem label="Executable at Slot" value={slashing.slotWhenExecutable.toString()} />
                        )}
                        {slashing.slotWhenExpires !== undefined && (
                          <DataItem label="Expires at Slot" value={slashing.slotWhenExpires.toString()} />
                        )}
                        {slashing.secondsUntilExecutable !== undefined && (
                          <DataItem label="Seconds Until Executable" value={slashing.secondsUntilExecutable.toString()} />
                        )}
                        {slashing.secondsUntilExpires !== undefined && (
                          <DataItem label="Seconds Until Expires" value={slashing.secondsUntilExpires.toString()} />
                        )}
                        {slashing.lastUpdatedTimestamp !== undefined && (
                          <DataItem label="Last Updated" value={new Date(slashing.lastUpdatedTimestamp).toLocaleString()} wide />
                        )}
                      </div>
                    </div>

                    {/* Target Epochs */}
                    {slashing.targetEpochs && slashing.targetEpochs.length > 0 && (
                      <div className="bg-malachite border-3 border-chartreuse p-4">
                        <h4 className="font-black mb-3 text-chartreuse uppercase text-sm flex items-center gap-2">
                          <svg className="w-4 h-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                          </svg>
                          Target Epochs ({slashing.targetEpochs.length})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {slashing.targetEpochs.map((epoch, idx) => (
                            <span key={idx} className="px-3 py-1 bg-brand-black border-3 border-chartreuse text-chartreuse font-black text-sm">
                              {epoch.toString()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Committees */}
                    {slashing.committees && slashing.committees.length > 0 && (
                      <div className="bg-lapis border-3 border-aqua p-4">
                        <h4 className="font-black mb-3 text-aqua uppercase text-sm flex items-center gap-2">
                          <svg className="w-4 h-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                          </svg>
                          TallyProposer.getSlashTargetCommittees() - {slashing.committees.length} committees
                        </h4>
                        <div className="space-y-3">
                          {slashing.committees.map((committee, idx) => (
                            <div key={idx} className="bg-brand-black border-3 border-aqua/50 p-3">
                              <div className="font-black text-xs mb-2 text-aqua uppercase">Committee {idx}</div>
                              <div className="space-y-2">
                                {committee.map((address, addrIdx) => (
                                  <div key={addrIdx} className="flex items-center gap-2">
                                    <code className="text-xs bg-brand-black border-3 border-whisper-white/20 px-3 py-2 flex-1 font-mono text-whisper-white">
                                      {address}
                                    </code>
                                    <button
                                      onClick={() => copyToClipboard(address)}
                                      className="text-xs px-3 py-2 bg-aqua hover:bg-aqua/90 text-brand-black border-3 border-brand-black font-black uppercase"
                                    >
                                      Copy
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Slash Actions */}
                    {slashing.slashActions && slashing.slashActions.length > 0 && (
                      <div className="bg-oxblood border-3 border-vermillion p-4">
                        <h4 className="font-black mb-3 text-vermillion uppercase text-sm flex items-center gap-2">
                          <svg className="w-4 h-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                          </svg>
                          TallyProposer.getTally() - {slashing.slashActions.length} validators
                        </h4>
                        <div className="space-y-2">
                          {slashing.slashActions.map((action, idx) => (
                            <div key={idx} className="flex items-center gap-3 bg-brand-black border-3 border-vermillion/50 p-3">
                              <span className="text-xs font-black w-8 text-vermillion">{idx + 1}.</span>
                              <code className="text-xs bg-brand-black border-3 border-whisper-white/20 px-3 py-2 flex-1 font-mono text-whisper-white">
                                {action.validator}
                              </code>
                              <span className="text-sm font-black text-vermillion w-36 text-right">
                                {formatEther(action.slashAmount)} ETH
                              </span>
                              <button
                                onClick={() => copyToClipboard(action.validator)}
                                className="text-xs px-3 py-2 bg-vermillion hover:bg-vermillion/90 text-brand-black border-3 border-brand-black font-black uppercase"
                              >
                                Copy
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Payload Address */}
                    {slashing.payloadAddress && (
                      <div className="bg-aubergine border-3 border-orchid p-4">
                        <h4 className="font-black mb-3 text-orchid uppercase text-sm flex items-center gap-2">
                          <svg className="w-4 h-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                          </svg>
                          TallyProposer.getPayloadAddress()
                        </h4>
                        <div className="flex items-center gap-3">
                          <code className="text-sm bg-brand-black border-3 border-orchid/50 px-4 py-3 flex-1 font-mono text-orchid">
                            {slashing.payloadAddress}
                          </code>
                          <button
                            onClick={() => copyToClipboard(slashing.payloadAddress!)}
                            className="px-4 py-3 bg-orchid hover:bg-orchid/90 text-brand-black border-3 border-brand-black font-black uppercase"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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

interface DataItemProps {
  label: string;
  value: string;
  wide?: boolean;
}

const DataItem: React.FC<DataItemProps> = ({ label, value, wide }) => {
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <span className="text-whisper-white/60 font-bold uppercase text-xs">{label}: </span>
      <span className="font-black text-whisper-white">{value}</span>
    </div>
  );
};

const getStatusStyles = (status: string): string => {
  switch (status) {
    case 'voting':
      return 'bg-lapis border-aqua text-aqua';
    case 'quorum-reached':
      return 'bg-aubergine border-orchid text-orchid';
    case 'in-veto-window':
      return 'bg-oxblood border-vermillion text-vermillion animate-pulse';
    case 'executable':
      return 'bg-malachite border-chartreuse text-chartreuse';
    case 'executed':
      return 'bg-brand-black border-whisper-white/30 text-whisper-white/60';
    case 'expired':
      return 'bg-oxblood border-vermillion/50 text-vermillion/50';
    default:
      return 'bg-brand-black border-whisper-white text-whisper-white';
  }
};
