import { useSlashingStore } from '@/store/slashingStore';
import { formatEther, formatNumber } from '@/lib/utils';
export function StatsPanel() {
    const { stats, config } = useSlashingStore();

    const clockIcon = (<svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>);

    const statCards = [
        {
            label: 'SLOT',
            value: config ? `${config.slotDuration}s` : '-',
            bgColor: 'bg-lapis',
            textColor: 'text-aqua',
            borderColor: 'border-aqua',
            shadowColor: 'shadow-brutal-aqua',
            icon: clockIcon,
        },
        {
            label: 'ROUND',
            value: config ? `${config.slashingRoundSize * config.slotDuration}s` : '-',
            bgColor: 'bg-lapis',
            textColor: 'text-aqua',
            borderColor: 'border-aqua',
            shadowColor: 'shadow-brutal-aqua',
            icon: clockIcon,
        },
        {
            label: 'EPOCH',
            value: config ? `${config.epochDuration * config.slotDuration}s` : '-',
            bgColor: 'bg-lapis',
            textColor: 'text-aqua',
            borderColor: 'border-aqua',
            shadowColor: 'shadow-brutal-aqua',
            icon: clockIcon,
        },
        {
            label: 'ACTIVE',
            value: stats.activeSlashings,
            bgColor: stats.activeSlashings > 0 ? 'bg-oxblood' : 'bg-malachite/30',
            textColor: stats.activeSlashings > 0 ? 'text-vermillion' : 'text-whisper-white/60',
            borderColor: stats.activeSlashings > 0 ? 'border-vermillion' : 'border-brand-black',
            shadowColor: stats.activeSlashings > 0 ? 'shadow-brutal-vermillion' : 'shadow-brutal',
            icon: (<svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>),
        },
        {
            label: 'VETOED',
            value: stats.vetoedPayloads,
            bgColor: 'bg-lapis',
            textColor: 'text-aqua',
            borderColor: 'border-aqua',
            shadowColor: 'shadow-brutal-aqua',
            icon: (<svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
        </svg>),
        },
        {
            label: 'EXECUTED',
            value: stats.executedRounds,
            bgColor: 'bg-oxblood',
            textColor: 'text-vermillion',
            borderColor: 'border-vermillion',
            shadowColor: 'shadow-brutal-vermillion',
            icon: (<svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>),
        },
        {
            label: 'SEQUENCERS HIT',
            value: stats.totalValidatorsSlashed,
            bgColor: 'bg-oxblood',
            textColor: 'text-vermillion',
            borderColor: 'border-vermillion',
            shadowColor: 'shadow-brutal-vermillion',
            icon: (<svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
        </svg>),
        },
        {
            label: 'TOTAL AZTEC',
            value: `${parseInt(formatEther(stats.totalSlashAmount), 10)}`,
            bgColor: 'bg-oxblood',
            textColor: 'text-vermillion',
            borderColor: 'border-vermillion',
            shadowColor: 'shadow-brutal-vermillion',
            icon: (<svg className="w-7 h-7 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>),
        },
    ];
    return (<div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
      {statCards.map((stat) => (<div key={stat.label} className={`${stat.bgColor} ${stat.borderColor} border-5 ${stat.shadowColor} p-5 transition-transform hover:-translate-y-1 hover:translate-x-1 hover:shadow-brutal-lg`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-black uppercase tracking-wider ${stat.textColor}`}>
              {stat.label}
            </span>
            <span className={stat.textColor}>{stat.icon}</span>
          </div>
          <div className={`text-3xl font-black ${stat.textColor} tracking-tight`}>
            {typeof stat.value === 'number' ? formatNumber(stat.value) : stat.value}
          </div>
        </div>))}
    </div>);
}
