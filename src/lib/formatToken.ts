const AZTEC_SCALE = 10n ** 18n;

export function formatAztec(value: string | bigint | null | undefined): string {
    if (value === null || value === undefined || value === '') return 'Unknown';
    try {
        const amount = BigInt(value);
        const negative = amount < 0n;
        const absolute = negative ? -amount : amount;
        const whole = absolute / AZTEC_SCALE;
        const fraction = (absolute % AZTEC_SCALE)
            .toString()
            .padStart(18, '0')
            .replace(/0+$/, '');
        const formattedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${negative ? '-' : ''}${formattedWhole}${fraction ? `.${fraction}` : ''}`;
    }
    catch {
        return String(value);
    }
}
