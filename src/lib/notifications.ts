import type { DetectedSlashing } from '@/types/slashing';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
        console.warn('This browser does not support notifications');
        return 'denied';
    }
    if (Notification.permission === 'granted') {
        return 'granted';
    }
    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission;
    }
    return Notification.permission;
}

export function areNotificationsEnabled(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
}

/**
 * Notify when a slashing round reaches quorum
 * Only sent if the round is not vetoed and not protected by global pause
 */
export function notifyQuorumReached(slashing: DetectedSlashing): void {
    if (!areNotificationsEnabled()) {
        return;
    }

    const validatorCount = slashing.affectedValidatorCount ?? 0;
    const roundNum = slashing.round.toString();
    const daysUntilExecutable = slashing.secondsUntilExecutable
        ? Math.ceil(slashing.secondsUntilExecutable / 86400)
        : '?';

    let body = `Round ${roundNum}: ${validatorCount} sequencer${validatorCount !== 1 ? 's' : ''} will be slashed`;
    body += `\n\nExecutable in ~${daysUntilExecutable} days`;
    body += '\nCan be vetoed at any time';

    if (slashing.totalSlashAmount) {
        const ethAmount = (Number(slashing.totalSlashAmount) / 1e18).toFixed(4);
        body += `\nTotal: ${ethAmount} AZTEC`;
    }

    try {
        const notification = new Notification('SLASHING QUORUM REACHED', {
            body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: `quorum-${roundNum}`,
            requireInteraction: true,
        });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    catch (error) {
        console.error('Failed to send notification:', error);
    }
}

/**
 * Notify when a round is vetoed
 */
export function notifyRoundVetoed(slashing: DetectedSlashing): void {
    if (!areNotificationsEnabled()) {
        return;
    }

    const validatorCount = slashing.affectedValidatorCount ?? 0;
    const roundNum = slashing.round.toString();

    let body = `Round ${roundNum} has been vetoed and will not be executed`;
    body += `\n\n${validatorCount} sequencer${validatorCount !== 1 ? 's' : ''} will not be slashed`;

    if (slashing.totalSlashAmount) {
        const ethAmount = (Number(slashing.totalSlashAmount) / 1e18).toFixed(4);
        body += `\nAmount: ${ethAmount} AZTEC`;
    }

    try {
        const notification = new Notification('SLASHING ROUND VETOED', {
            body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: `vetoed-${roundNum}`,
        });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    catch (error) {
        console.error('Failed to send notification:', error);
    }
}

/**
 * Notify when global slashing pause is activated
 */
export function notifyGlobalPauseStarted(): void {
    if (!areNotificationsEnabled()) {
        return;
    }

    try {
        const notification = new Notification('GLOBAL SLASHING PAUSE ACTIVATED', {
            body: 'All slashing executions are paused. No slashings will be executed until the pause expires.',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'global-pause-started',
            requireInteraction: true,
        });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    catch (error) {
        console.error('Failed to send notification:', error);
    }
}

/**
 * Notify when global slashing pause ends
 */
export function notifyGlobalPauseEnded(): void {
    if (!areNotificationsEnabled()) {
        return;
    }

    try {
        const notification = new Notification('GLOBAL SLASHING PAUSE ENDED', {
            body: 'The global slashing pause has expired. Slashing executions can now proceed.',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'global-pause-ended',
        });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    catch (error) {
        console.error('Failed to send notification:', error);
    }
}

/**
 * Notify when a slashing round is executed
 */
export function notifyRoundExecuted(slashing: DetectedSlashing): void {
    if (!areNotificationsEnabled()) {
        return;
    }

    const validatorCount = slashing.affectedValidatorCount ?? 0;
    const roundNum = slashing.round.toString();

    let body = `Round ${roundNum} has been executed`;
    body += `\n\n${validatorCount} sequencer${validatorCount !== 1 ? 's' : ''} slashed`;

    if (slashing.totalSlashAmount) {
        const ethAmount = (Number(slashing.totalSlashAmount) / 1e18).toFixed(4);
        body += `\nTotal slashed: ${ethAmount} AZTEC`;
    }

    try {
        const notification = new Notification('SLASHING EXECUTED', {
            body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: `executed-${roundNum}`,
            requireInteraction: true,
        });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    catch (error) {
        console.error('Failed to send notification:', error);
    }
}

/**
 * Notify when the bootstrap phase ends and the network launches
 */
export function notifyNetworkLaunched(): void {
    if (!areNotificationsEnabled()) {
        return;
    }

    try {
        const notification = new Notification('Network launched! 🚀', {
            body: 'The bootstrap phase has ended. Slashing is now active on the network.',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'network-launched',
            requireInteraction: true,
        });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    catch (error) {
        console.error('Failed to send notification:', error);
    }
}
