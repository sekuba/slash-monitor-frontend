import { useSlashingStore } from '@/store/slashingStore';

const TARGET_VALIDATORS = 500;

export function BootstrapBanner() {
  const { activeAttesterCount, entryQueueLength } = useSlashingStore();

  // Don't show banner if there are active validators
  if (activeAttesterCount === null || activeAttesterCount > 0n) {
    return null;
  }

  const currentValidators = Number(entryQueueLength || 0n);
  const progressPercentage = Math.min((currentValidators / TARGET_VALIDATORS) * 100, 100);

  return (
    <div className="bg-lapis border-5 border-aqua p-6 mb-6 shadow-brutal-aqua">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 bg-aqua border-3 border-brand-black p-3">
          <svg className="w-10 h-10 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-aqua font-black uppercase text-2xl">Bootstrap Phase</h3>
            <div className="text-aqua font-black text-xl">
              {currentValidators} / {TARGET_VALIDATORS}
            </div>
          </div>

          <p className="text-whisper-white text-sm font-bold mb-4 uppercase">
            active attesters = 0 Waiting for sequencers to register and join the queue
          </p>

          {/* Progress Bar */}
          <div className="relative">
            {/* Background */}
            <div className="w-full h-10 bg-brand-black border-5 border-aqua overflow-hidden">
              {/* Fill */}
              <div
                className="h-full bg-aqua transition-all duration-500 ease-out flex items-center justify-end pr-3"
                style={{ width: `${progressPercentage}%` }}
              >
                {progressPercentage > 15 && (
                  <span className="text-brand-black font-black text-sm uppercase">
                    {progressPercentage.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            {/* Percentage outside bar if too narrow */}
            {progressPercentage <= 15 && progressPercentage > 0 && (
              <div className="absolute left-2 top-0 h-10 flex items-center">
                <span className="text-aqua font-black text-sm uppercase">
                  {progressPercentage.toFixed(1)}%
                </span>
              </div>
            )}
          </div>

          {/* Entry Queue Info */}
          <div className="mt-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-aqua stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span className="text-whisper-white/80 text-xs font-bold uppercase">
              Rollup.getEntryQueueLength(): {currentValidators}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
