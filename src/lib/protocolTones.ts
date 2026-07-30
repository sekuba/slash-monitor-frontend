export const PROTOCOL_TONES = {
    node: {
        surface: 'border-orchid bg-aubergine text-orchid',
        active: 'border-orchid bg-orchid text-brand-black',
        pulseColor: 'var(--color-orchid)',
    },
    voting: {
        surface: 'border-aqua bg-lapis text-aqua',
        active: 'border-aqua bg-aqua text-brand-black',
        pulseColor: 'var(--color-aqua)',
    },
    execution: {
        surface: 'border-vermillion bg-oxblood text-vermillion',
        active: 'border-vermillion bg-vermillion text-brand-black',
        pulseColor: 'var(--color-vermillion)',
    },
    outcome: {
        surface: 'border-chartreuse bg-malachite text-chartreuse',
        active: 'border-chartreuse bg-chartreuse text-brand-black',
        pulseColor: 'var(--color-chartreuse)',
    },
} as const;
