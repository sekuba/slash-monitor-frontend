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
export function notifySlashingDetected(slashing: DetectedSlashing): void {
    if (!areNotificationsEnabled()) {
        return;
    }
    const validatorCount = slashing.affectedValidatorCount ?? 0;
    const roundNum = slashing.round.toString();
    let title = 'SLASHING ROUND DETECTED';
    let body = `Round ${roundNum}: ${validatorCount} sequencer${validatorCount !== 1 ? 's' : ''} will be slashed`;
    if (slashing.status === 'quorum-reached') {
        title = 'SLASHING QUORUM REACHED';
        const daysUntilExecutable = slashing.secondsUntilExecutable
            ? Math.ceil(slashing.secondsUntilExecutable / 86400)
            : '?';
        body += `\n\nExecutable in ~${daysUntilExecutable} days`;
        body += '\nVeto available now';
    }
    else if (slashing.status === 'in-veto-window') {
        title = 'SLASHING NOW EXECUTABLE';
        body += '\n\nSlashing can be executed at any time';
        body += '\nReview and veto if needed';
    }
    else if (slashing.status === 'executable') {
        title = 'SLASHING READY TO EXECUTE';
        body += '\n\nThis slashing can now be executed';
    }
    if (slashing.totalSlashAmount) {
        const ethAmount = (Number(slashing.totalSlashAmount) / 1e18).toFixed(4);
        body += `\nTotal: ${ethAmount} AZTEC`;
    }
    try {
        const notification = new Notification(title, {
            body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: `slashing-${roundNum}`,
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
export function notifySlashingDisabled(): void {
    if (!areNotificationsEnabled()) {
        return;
    }
    try {
        const notification = new Notification('SLASHING DISABLED', {
            body: 'Slashing has been disabled by the VETOER. No slashings will be executed.',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'slashing-disabled',
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
export function notifySlashingEnabled(): void {
    if (!areNotificationsEnabled()) {
        return;
    }
    try {
        const notification = new Notification('SLASHING ENABLED', {
            body: 'Slashing has been re-enabled. Monitoring resumed.',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'slashing-enabled',
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
