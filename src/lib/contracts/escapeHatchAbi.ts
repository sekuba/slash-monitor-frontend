export const escapeHatchAbi = [{
    type: 'function',
    name: 'isHatchOpen',
    stateMutability: 'view',
    inputs: [{ name: '_epoch', type: 'uint256' }],
    outputs: [
        { name: 'isOpen', type: 'bool' },
        { name: 'proposer', type: 'address' },
    ],
}] as const;
