import type { DetectedSlashing } from '@/types/slashing'

/**
 * Request notification permission from the browser
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications')
    return 'denied'
  }

  if (Notification.permission === 'granted') {
    return 'granted'
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission()
    return permission
  }

  return Notification.permission
}

/**
 * Check if notifications are enabled and granted
 */
export function areNotificationsEnabled(): boolean {
  return 'Notification' in window && Notification.permission === 'granted'
}

/**
 * Send a notification for a detected slashing
 */
export function notifySlashingDetected(slashing: DetectedSlashing): void {
  if (!areNotificationsEnabled()) {
    return
  }

  const validatorCount = slashing.affectedValidatorCount ?? 0
  const roundNum = slashing.round.toString()

  let title = '⚠️ Slashing Round Detected!'
  let body = `Round ${roundNum}: ${validatorCount} validator${validatorCount !== 1 ? 's' : ''} will be slashed`

  // Customize based on status
  if (slashing.status === 'quorum-reached') {
    title = '🔔 Early Warning: Slashing Quorum Reached!'
    const daysUntilExecutable = slashing.secondsUntilExecutable
      ? Math.ceil(slashing.secondsUntilExecutable / 86400)
      : '?'
    body += `\n\n⏰ Executable in ~${daysUntilExecutable} days`
    body += '\n✓ You can veto NOW (no need to wait!)'
  } else if (slashing.status === 'in-veto-window') {
    title = '🚨 Slashing Now Executable!'
    body += '\n\n⚡ URGENT: Slashing can be executed at any time'
    body += '\n✓ Review and veto immediately if needed'
  } else if (slashing.status === 'executable') {
    title = '⚡ Slashing Ready to Execute!'
    body += '\n\nAction required: This slashing can now be executed'
  }

  // Add total slash amount if available
  if (slashing.totalSlashAmount) {
    const ethAmount = (Number(slashing.totalSlashAmount) / 1e18).toFixed(4)
    body += `\nTotal: ${ethAmount} ETH`
  }

  try {
    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: `slashing-${roundNum}`, // Prevents duplicate notifications for the same round
      requireInteraction: true, // Keeps notification visible until user interacts
    })

    // Optional: Add click handler to focus the window
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch (error) {
    console.error('Failed to send notification:', error)
  }
}

/**
 * Send a notification when slashing is disabled
 */
export function notifySlashingDisabled(): void {
  if (!areNotificationsEnabled()) {
    return
  }

  try {
    const notification = new Notification('🛑 Slashing Disabled', {
      body: 'Slashing has been disabled by the VETOER. No slashings will be executed.',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'slashing-disabled',
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch (error) {
    console.error('Failed to send notification:', error)
  }
}

/**
 * Send a notification when slashing is enabled
 */
export function notifySlashingEnabled(): void {
  if (!areNotificationsEnabled()) {
    return
  }

  try {
    const notification = new Notification('✅ Slashing Enabled', {
      body: 'Slashing has been re-enabled. Monitoring will resume.',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'slashing-enabled',
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch (error) {
    console.error('Failed to send notification:', error)
  }
}

/**
 * Send a notification when a round is executed
 */
export function notifyRoundExecuted(round: bigint, slashCount: bigint): void {
  if (!areNotificationsEnabled()) {
    return
  }

  try {
    const notification = new Notification('✓ Slashing Executed', {
      body: `Round ${round.toString()} has been executed with ${slashCount.toString()} validators slashed`,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: `round-executed-${round.toString()}`,
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch (error) {
    console.error('Failed to send notification:', error)
  }
}
