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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center bg-brand-black border-5 border-chartreuse p-8 shadow-brutal-chartreuse">
          <div className="animate-spin h-16 w-16 border-5 border-chartreuse border-t-transparent mx-auto mb-4"></div>
          <p className="text-chartreuse font-black uppercase tracking-wider">Initializing Monitor...</p>
        </div>
      </div>
    )
  }

  // Convert map to array and sort by round (descending)
  const slashings = Array.from(detectedSlashings.values()).sort((a, b) => Number(b.round - a.round))

  // Filter for active slashings (quorum reached, in veto window, or executable)
  // Sort ascending (oldest first) - older rounds are more urgent
  const activeSlashings = slashings.filter((s) => isActionableStatus(s.status))
    .sort((a, b) => Number(a.round - b.round))

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Stats Panel */}
        <StatsPanel />

        {/* Notification Banner */}
        {showNotificationBanner && !areNotificationsEnabled() && (
          <div className="bg-lapis border-5 border-aqua p-6 mb-6 shadow-brutal-aqua">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 bg-aqua border-3 border-brand-black p-2">
                <svg className="w-8 h-8 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-aqua font-black uppercase text-lg mb-2">Enable Notifications</h3>
                <p className="text-whisper-white text-sm font-bold mb-4">
                  Get instant alerts when slashings are detected or action is required.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleEnableNotifications}
                    disabled={isRequestingNotifications}
                    className="px-6 py-3 bg-chartreuse hover:bg-chartreuse/90 disabled:bg-chartreuse/50 text-brand-black border-3 border-brand-black font-black uppercase text-sm transition-transform hover:-translate-y-0.5 shadow-brutal"
                  >
                    {isRequestingNotifications ? 'Requesting...' : 'Enable Now'}
                  </button>
                  <button
                    onClick={() => setShowNotificationBanner(false)}
                    className="px-6 py-3 bg-transparent hover:bg-aqua/20 text-aqua border-3 border-aqua font-black uppercase text-sm transition-colors"
                  >
                    Later
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowNotificationBanner(false)}
                className="flex-shrink-0 text-aqua hover:text-whisper-white transition-colors"
                aria-label="Dismiss"
              >
                <svg className="w-6 h-6 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Slashing Timeline */}
        <SlashingTimeline />

        {/* Scanning Banner */}
        {isScanning && (
          <div className="mb-6 bg-lapis border-5 border-aqua p-5 shadow-brutal-aqua">
            <div className="flex items-center gap-4">
              <div className="animate-spin h-8 w-8 border-5 border-aqua border-t-transparent"></div>
              <div>
                <h3 className="text-aqua font-black uppercase text-lg">Scanning Historical Rounds</h3>
                <p className="text-whisper-white text-sm font-bold">
                  Performing initial scan. Notifications enabled after completion.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Slashing Status Alert */}
        {!isSlashingEnabled && (
          <div className="mb-6 bg-malachite border-5 border-chartreuse p-5 shadow-brutal-chartreuse">
            <div className="flex items-center gap-4">
              <div className="bg-chartreuse border-3 border-brand-black p-2">
                <svg className="w-8 h-8 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-chartreuse font-black uppercase text-lg">Slashing Disabled</h3>
                <p className="text-whisper-white text-sm font-bold">
                  Slashing currently disabled by VETOER. No executions will occur.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Active Slashings Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-black text-whisper-white mb-6 flex items-center gap-4">
            <span className="inline-flex items-center justify-center w-12 h-12 bg-vermillion border-5 border-brand-black text-brand-black font-black shadow-brutal">
              {activeSlashings.length}
            </span>
            ACTIVE SLASHING ROUNDS
            {activeSlashings.length > 0 && (
              <span className="text-base font-black text-vermillion uppercase">(Action Required)</span>
            )}
          </h2>

          {activeSlashings.length === 0 ? (
            <div className="bg-malachite/20 border-5 border-brand-black p-12 text-center shadow-brutal">
              <div className="bg-chartreuse border-3 border-brand-black p-4 inline-block mb-4">
                <svg
                  className="w-16 h-16 text-brand-black stroke-[3]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                    strokeWidth={3}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-whisper-white text-xl font-black uppercase">No Active Slashing Rounds</p>
              <p className="text-whisper-white/70 text-sm font-bold uppercase mt-2">
                Monitoring Round {currentRound?.toString()}
              </p>
            </div>
          ) : (
            <div className="grid gap-6">
              {activeSlashings.map((slashing) => (
                <RoundCard key={slashing.round.toString()} slashing={slashing} />
              ))}
            </div>
          )}
        </div>

        {/* All Rounds Section (includes executed rounds for verification) */}
        {slashings.length > activeSlashings.length && (
          <div>
            <h2 className="text-3xl font-black text-whisper-white mb-6 uppercase">All Detected Rounds</h2>
            <div className="grid gap-6">
              {slashings.map((slashing) => (
                <RoundCard key={slashing.round.toString()} slashing={slashing} />
              ))}
            </div>
          </div>
        )}

        {slashings.length === 0 && activeSlashings.length === 0 && (
          <div className="bg-malachite/20 border-5 border-brand-black p-8 text-center shadow-brutal">
            <p className="text-whisper-white font-black uppercase text-lg">No Slashing Rounds Detected</p>
            <p className="text-whisper-white/70 text-sm font-bold uppercase mt-2">Monitoring continues in background</p>
          </div>
        )}
      </main>
    </div>
  )
}
