import { useState, useEffect } from 'react'
import { useSlashingStore } from '@/store/slashingStore'
import { RoundCard } from './RoundCard'
import { StatsPanel } from './StatsPanel'
import { Header } from './Header'
import { SlashingTimeline } from './SlashingTimeline'
import { isActionableStatus } from '@/lib/utils'
import { requestNotificationPermission, areNotificationsEnabled } from '@/lib/notifications'

export function Dashboard() {
  const { detectedSlashings, isInitialized, isScanning, currentRound, isSlashingEnabled } = useSlashingStore()
  const [showNotificationBanner, setShowNotificationBanner] = useState(false)
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false)

  useEffect(() => {
    // Check if we should show the notification banner
    if ('Notification' in window && Notification.permission === 'default') {
      setShowNotificationBanner(true)
    }
  }, [])

  const handleEnableNotifications = async () => {
    setIsRequestingNotifications(true)
    try {
      const permission = await requestNotificationPermission()
      if (permission === 'granted' || permission === 'denied') {
        setShowNotificationBanner(false)
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error)
    } finally {
      setIsRequestingNotifications(false)
    }
  }

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Initializing Slashing Monitor...</p>
        </div>
      </div>
    )
  }

  // Convert map to array and sort by round (descending)
  const slashings = Array.from(detectedSlashings.values()).sort((a, b) => Number(b.round - a.round))

  // Filter for active slashings (quorum reached, in veto window, or executable)
  const activeSlashings = slashings.filter((s) => isActionableStatus(s.status))

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Stats Panel */}
        <StatsPanel />

        {/* Notification Banner */}
        {showNotificationBanner && !areNotificationsEnabled() && (
          <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-blue-400 font-semibold mb-1">Enable Browser Notifications</h3>
                <p className="text-blue-300/80 text-sm mb-3">
                  Get instant alerts when slashings are detected or when action is required.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleEnableNotifications}
                    disabled={isRequestingNotifications}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded font-medium text-sm transition-colors"
                  >
                    {isRequestingNotifications ? 'Requesting...' : 'Enable Notifications'}
                  </button>
                  <button
                    onClick={() => setShowNotificationBanner(false)}
                    className="px-4 py-2 bg-transparent hover:bg-blue-800/30 text-blue-300 rounded font-medium text-sm transition-colors"
                  >
                    Maybe Later
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowNotificationBanner(false)}
                className="flex-shrink-0 text-blue-400 hover:text-blue-300 transition-colors"
                aria-label="Dismiss"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Slashing Timeline */}
        <SlashingTimeline />

        {/* Scanning Banner */}
        {isScanning && (
          <div className="mb-6 bg-blue-900/20 border border-blue-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
              <div>
                <h3 className="text-blue-400 font-semibold">Scanning Historical Rounds</h3>
                <p className="text-blue-300/80 text-sm">
                  Performing initial scan of slashing rounds. Notifications will be enabled after scan completes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Slashing Status Alert */}
        {!isSlashingEnabled && (
          <div className="mb-6 bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="text-yellow-500 font-semibold">Slashing Disabled</h3>
                <p className="text-yellow-300/80 text-sm">
                  Slashing is currently disabled by the VETOER. No slashings will be executed.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Active Slashings Section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500/20 text-red-500">
              {activeSlashings.length}
            </span>
            Active Slashing Rounds
            {activeSlashings.length > 0 && (
              <span className="text-sm font-normal text-red-400">(Action Required)</span>
            )}
          </h2>

          {activeSlashings.length === 0 ? (
            <div className="bg-gray-900 rounded-lg p-8 text-center border border-gray-800">
              <svg
                className="w-16 h-16 text-gray-600 mx-auto mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-gray-400 text-lg">No active slashing rounds</p>
              <p className="text-gray-500 text-sm mt-2">
                Currently monitoring round {currentRound?.toString()}
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {activeSlashings.map((slashing) => (
                <RoundCard key={slashing.round.toString()} slashing={slashing} />
              ))}
            </div>
          )}
        </div>

        {/* All Rounds Section (includes executed rounds for verification) */}
        {slashings.length > activeSlashings.length && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-4">All Detected Rounds</h2>
            <div className="grid gap-4">
              {slashings.map((slashing) => (
                <RoundCard key={slashing.round.toString()} slashing={slashing} />
              ))}
            </div>
          </div>
        )}

        {slashings.length === 0 && activeSlashings.length === 0 && (
          <div className="bg-gray-900 rounded-lg p-8 text-center border border-gray-800">
            <p className="text-gray-400">No slashing rounds detected yet</p>
            <p className="text-gray-500 text-sm mt-2">Monitoring will continue in the background</p>
          </div>
        )}
      </main>
    </div>
  )
}
