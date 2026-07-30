const AZTEC_SCALE = 10n ** 18n;

export function formatAztec(value: string | bigint): string {
    try {
        const amount = BigInt(value);
        const negative = amount < 0n;
        const absolute = negative ? -amount : amount;
        const whole = absolute / AZTEC_SCALE;
        const fraction = (absolute % AZTEC_SCALE)
            .toString()
            .padStart(18, '0')
            .replace(/0+$/, '');
        return `${negative ? '-' : ''}${group(whole.toString())}${fraction ? `.${fraction}` : ''}`;
    }
    catch {
        return String(value);
    }
}

export function shortAddress(address: string): string {
    return /^0x[0-9a-f]{40}$/i.test(address)
        ? `${address.slice(0, 6)}…${address.slice(-4)}`
        : address;
}

export function humanizeOffense(value: string): string {
    return value
        .replace(/^broadcasted_/, 'broadcasted ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function group(value: string): string {
    return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
