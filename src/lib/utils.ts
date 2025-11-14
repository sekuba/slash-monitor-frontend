import type { Address } from 'viem';
import type { RoundStatus, Offense } from '@/types/slashing';
import { OffenseType } from '@/types/slashing';
export function formatAddress(address: Address, chars = 6): string {
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
export function formatEther(wei: bigint, decimals = 4): string {
    const ether = Number(wei) / 1e18;
    return ether.toFixed(decimals);
}
export function formatTimeRemaining(seconds: number): string {
    if (seconds <= 0) {
        return 'Expired';
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m ${secs}s`;
    }
    else if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    }
    else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    }
    else {
        return `${secs}s`;
    }
}
export function formatNumber(num: number | bigint): string {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function isActionableStatus(status: RoundStatus): boolean {
    return (status === 'quorum-reached' ||
        status === 'in-veto-window' ||
        status === 'executable');
}
export function getStatusColor(status: RoundStatus): string {
    switch (status) {
        case 'quorum-reached':
            return 'bg-lapis text-aqua border-5 border-aqua shadow-brutal-aqua';
        case 'in-veto-window':
            return 'bg-oxblood text-vermillion border-5 border-vermillion shadow-brutal-vermillion';
        case 'executable':
            return 'bg-oxblood text-vermillion border-5 border-vermillion shadow-brutal-vermillion';
        case 'executed':
            return 'bg-oxblood/50 text-vermillion border-5 border-vermillion/50 shadow-brutal';
        case 'expired':
            return 'bg-malachite/30 text-whisper-white/60 border-5 border-brand-black shadow-brutal';
        case 'voting':
            return 'bg-lapis/50 text-whisper-white border-5 border-brand-black shadow-brutal';
        default:
            return 'bg-lapis text-aqua border-5 border-aqua shadow-brutal-aqua';
    }
}
export function getStatusText(status: RoundStatus): string {
    switch (status) {
        case 'quorum-reached':
            return 'Quorum Reached';
        case 'in-veto-window':
            return 'Newly Executable';
        case 'executable':
            return 'Executable';
        case 'executed':
            return 'Executed';
        case 'expired':
            return 'Expired';
        case 'voting':
            return 'Voting';
        default:
            return 'Pending';
    }
}
export function getOffenseTypeName(offenseType: OffenseType): string {
    switch (offenseType) {
        case OffenseType.DATA_WITHHOLDING:
            return 'Data Withholding';
        case OffenseType.VALID_EPOCH_PRUNED:
            return 'Epoch Pruned';
        case OffenseType.INACTIVITY:
            return 'Inactivity';
        case OffenseType.BROADCASTED_INVALID_BLOCK_PROPOSAL:
            return 'Invalid Broadcast';
        case OffenseType.PROPOSED_INSUFFICIENT_ATTESTATIONS:
            return 'Insufficient Attestations';
        case OffenseType.PROPOSED_INCORRECT_ATTESTATIONS:
            return 'Incorrect Attestations';
        case OffenseType.ATTESTED_DESCENDANT_OF_INVALID:
            return 'Attested Invalid';
        case OffenseType.UNKNOWN:
        default:
            return 'Unknown';
    }
}
export function getOffenseTypeColor(offenseType: OffenseType): string {
    switch (offenseType) {
        case OffenseType.DATA_WITHHOLDING:
            return 'bg-oxblood text-vermillion border-3 border-vermillion';
        case OffenseType.VALID_EPOCH_PRUNED:
            return 'bg-oxblood/70 text-vermillion border-3 border-vermillion/70';
        case OffenseType.INACTIVITY:
            return 'bg-malachite text-chartreuse border-3 border-chartreuse';
        case OffenseType.BROADCASTED_INVALID_BLOCK_PROPOSAL:
            return 'bg-aubergine text-orchid border-3 border-orchid';
        case OffenseType.PROPOSED_INSUFFICIENT_ATTESTATIONS:
            return 'bg-aubergine/70 text-orchid border-3 border-orchid/70';
        case OffenseType.PROPOSED_INCORRECT_ATTESTATIONS:
            return 'bg-aubergine/50 text-orchid/80 border-3 border-orchid/80';
        case OffenseType.ATTESTED_DESCENDANT_OF_INVALID:
            return 'bg-lapis text-aqua border-3 border-aqua';
        case OffenseType.UNKNOWN:
        default:
            return 'bg-malachite/30 text-whisper-white border-3 border-brand-black';
    }
}
export function findOffenseForValidator(validator: Address, targetEpochs: bigint[], offenses: Offense[], round?: bigint): Offense | undefined {
    const normalizedValidator = validator.toLowerCase();
    const exactMatch = offenses.find((offense) => {
        if (offense.validator.toLowerCase() !== normalizedValidator) {
            return false;
        }
        if (offense.epoch !== undefined) {
            return targetEpochs.some(epoch => epoch === offense.epoch);
        }
        return false;
    });
    if (exactMatch)
        return exactMatch;
    if (round !== undefined) {
        const roundMatch = offenses.find((offense) => {
            if (offense.validator.toLowerCase() !== normalizedValidator) {
                return false;
            }
            if (offense.round !== undefined) {
                return offense.round === round;
            }
            return false;
        });
        if (roundMatch)
            return roundMatch;
    }
    const validatorMatch = offenses.find((offense) => {
        if (offense.validator.toLowerCase() !== normalizedValidator) {
            return false;
        }
        return offense.epoch === undefined && offense.round === undefined;
    });
    return validatorMatch;
}
