import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SequencerLink } from './SequencerLink';

const ADDRESS = '0x1111111111111111111111111111111111111111';

describe('SequencerLink', () => {
    it('uses the Dashtec deployment for the selected network', () => {
        const mainnet = renderToStaticMarkup(
            <SequencerLink address={ADDRESS} network="mainnet" />,
        );
        const testnet = renderToStaticMarkup(
            <SequencerLink address={ADDRESS} network="testnet" />,
        );

        expect(mainnet).toContain(`href="https://dashtec.xyz/sequencers/${ADDRESS}"`);
        expect(testnet).toContain(`href="https://testnet.dashtec.xyz/sequencers/${ADDRESS}"`);
        expect(mainnet).toContain('target="_blank"');
        expect(mainnet).toContain('rel="noreferrer"');
    });
});
