import { useState, useEffect } from 'react'
import { requestNotificationPermission, areNotificationsEnabled } from '@/lib/notifications'

export function NotificationBanner() {
  const [showBanner, setShowBanner] = useState(false)
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    // Check if we should show the banner
    if ('Notification' in window && Notification.permission === 'default') {
      setShowBanner(true)
    }
  }, [])

  const handleEnableNotifications = async () => {
    setIsRequesting(true)
    try {
      const permission = await requestNotificationPermission()
      if (permission === 'granted') {
        setShowBanner(false)
        console.log('Notifications enabled successfully')
      } else if (permission === 'denied') {
        setShowBanner(false)
        console.log('Notifications denied by user')
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error)
    } finally {
      setIsRequesting(false)
    }
  }

  const handleDismiss = () => {
    setShowBanner(false)
  }

  if (!showBanner || areNotificationsEnabled()) {
    return null
  }

  return (
    <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <svg
            className="w-6 h-6 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-blue-400 font-semibold mb-1">Enable Browser Notifications</h3>
          <p className="text-blue-300/80 text-sm mb-3">
            Get instant alerts when slashings are detected or when action is required. You'll be
            notified about:
          </p>
          <ul className="text-blue-300/70 text-sm space-y-1 mb-3 list-disc list-inside">
            <li>New slashings in veto window (action required)</li>
            <li>Slashings ready to execute</li>
            <li>Slashing enabled/disabled status changes</li>
            <li>Round execution confirmations</li>
          </ul>
          <div className="flex gap-2">
            <button
              onClick={handleEnableNotifications}
              disabled={isRequesting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded font-medium text-sm transition-colors"
            >
              {isRequesting ? 'Requesting...' : 'Enable Notifications'}
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 bg-transparent hover:bg-blue-800/30 text-blue-300 rounded font-medium text-sm transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-blue-400 hover:text-blue-300 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
