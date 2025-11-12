import { useState } from 'react'
import type { Address } from 'viem'
import { useSlashingStore } from '@/store/slashingStore'

interface VetoInstructionsProps {
  payloadAddress: Address
}

export function VetoInstructions({ payloadAddress }: VetoInstructionsProps) {
  const { config } = useSlashingStore()
  const [copied, setCopied] = useState(false)

  if (!config) return null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(payloadAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), config.copyFeedbackDuration)
  }

  return (
    <div className="bg-malachite border-5 border-chartreuse p-6 space-y-4 shadow-brutal-chartreuse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-black text-chartreuse mb-3 uppercase tracking-wider">
            Veto Instructions
          </h3>
          <p className="text-sm text-whisper-white font-bold mb-4">
            To veto this slashing, call <code className="bg-brand-black px-2 py-1 border-3 border-chartreuse text-chartreuse font-bold">vetoPayload(address)</code> on the Slasher contract{' '}
            ({config.slasherAddress ? (
              <span className="font-mono text-aqua">{config.slasherAddress.slice(0, 6)}...{config.slasherAddress.slice(-4)}</span>
            ) : 'Unknown'})
            {' '}with the payload address below.
          </p>

          <div className="space-y-3">
            <label className="text-xs text-chartreuse font-black uppercase tracking-wider">Payload Address:</label>
            <div className="flex items-center gap-3">
              <code className="flex-1 bg-brand-black px-4 py-3 border-3 border-whisper-white text-sm font-mono text-whisper-white font-bold break-all">
                {payloadAddress}
              </code>
              <button
                onClick={handleCopy}
                className="px-6 py-3 bg-chartreuse hover:bg-chartreuse/90 border-3 border-brand-black transition-transform hover:-translate-y-0.5 text-sm font-black uppercase shrink-0 shadow-brutal"
                title="Copy payload address"
              >
                {copied ? (
                  <span className="text-brand-black">COPIED</span>
                ) : (
                  <span className="text-brand-black">COPY</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
