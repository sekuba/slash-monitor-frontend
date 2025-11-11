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
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-yellow-300 mb-1">
            Veto Instructions
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            To veto this slashing, call <code className="bg-gray-950 px-1 py-0.5 rounded">vetoPayload(address)</code> on the Slasher contract{' '}
            ({config.slasherAddress ? (
              <span className="font-mono">{config.slasherAddress.slice(0, 6)}...{config.slasherAddress.slice(-4)}</span>
            ) : 'Unknown'})
            {' '}with the payload address below.
          </p>

          <div className="space-y-2">
            <label className="text-xs text-gray-500">Payload Address:</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-950 px-3 py-2 rounded border border-gray-800 text-sm font-mono text-white break-all">
                {payloadAddress}
              </code>
              <button
                onClick={handleCopy}
                className="px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded transition-colors text-sm font-medium shrink-0"
                title="Copy payload address"
              >
                {copied ? (
                  <span className="text-green-400">✓ Copied</span>
                ) : (
                  <span className="text-gray-300">Copy</span>
                )}
              </button>
            </div>
          </div>

          {config.vetoerAddress && (
            <p className="text-xs text-gray-500 mt-2">
              Authorized vetoer: <span className="font-mono">{config.vetoerAddress.slice(0, 10)}...{config.vetoerAddress.slice(-4)}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
