import type { DetectedSlashing } from '@/types/slashing';

const ICON_PATH = '/favicon.ico';
const DAY_IN_SECONDS = 86400;

export async function requestNotificationPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
        console.warn('This browser does not support notifications');
        return 'denied';
    }

    if (Notification.permission === 'granted') {
        return 'granted';
    }

    if (Notification.permission !== 'denied') {
        return Notification.requestPermission();
    }

    return Notification.permission;
}

export function areNotificationsEnabled(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
}

function pushNotification(title: string, body: string, tag: string, requireInteraction = false): void {
    if (!areNotificationsEnabled()) {
        return;
    }

    try {
        const notification = new Notification(title, {
            body,
            icon: ICON_PATH,
            badge: ICON_PATH,
            tag,
            requireInteraction,
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

export function notifyQuorumReached(slashing: DetectedSlashing): void {
    const validatorCount = slashing.affectedValidatorCount ?? 0;
    const roundNum = slashing.round.toString();
    const daysUntilExecutable = slashing.secondsUntilExecutable
        ? Math.ceil(slashing.secondsUntilExecutable / DAY_IN_SECONDS)
        : null;

    const parts = [
        `Round ${roundNum} reached quorum`,
        `${validatorCount} sequencer${validatorCount === 1 ? '' : 's'} targeted`,
    ];

    if (daysUntilExecutable !== null) {
        parts.push(`Executable in ~${daysUntilExecutable} day${daysUntilExecutable === 1 ? '' : 's'}`);
    }

    if (slashing.totalSlashAmount) {
        const aztecAmount = (Number(slashing.totalSlashAmount) / 1e18).toFixed(4);
        parts.push(`Total: ${aztecAmount} AZTEC`);
    }

    pushNotification('SLASHING QUORUM REACHED', parts.join('\n'), `quorum-${roundNum}`, true);
}

export function notifyRoundVetoed(slashing: DetectedSlashing): void {
    const validatorCount = slashing.affectedValidatorCount ?? 0;
    const roundNum = slashing.round.toString();
    const parts = [
        `Round ${roundNum} vetoed`,
        `${validatorCount} sequencer${validatorCount === 1 ? '' : 's'} spared`,
    ];

    if (slashing.totalSlashAmount) {
        const aztecAmount = (Number(slashing.totalSlashAmount) / 1e18).toFixed(4);
        parts.push(`Amount: ${aztecAmount} AZTEC`);
    }

    pushNotification('SLASHING ROUND VETOED', parts.join('\n'), `vetoed-${roundNum}`);
}

export function notifyGlobalPauseStarted(): void {
    pushNotification('GLOBAL SLASHING PAUSE', 'Slashing execution is paused until the veto lifts.', 'global-pause-started', true);
}

export function notifyRoundExecuted(slashing: DetectedSlashing): void {
    const validatorCount = slashing.affectedValidatorCount ?? 0;
    const roundNum = slashing.round.toString();
    const parts = [
        `Round ${roundNum} executed`,
        `${validatorCount} sequencer${validatorCount === 1 ? '' : 's'} slashed`,
    ];

    if (slashing.totalSlashAmount) {
        const aztecAmount = (Number(slashing.totalSlashAmount) / 1e18).toFixed(4);
        parts.push(`Total: ${aztecAmount} AZTEC`);
    }

    pushNotification('SLASHING EXECUTED', parts.join('\n'), `executed-${roundNum}`, true);
}
