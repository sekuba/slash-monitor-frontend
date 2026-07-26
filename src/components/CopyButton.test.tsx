import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
    it('uses a labeled clipboard action instead of an unexplained icon', () => {
        const markup = renderToStaticMarkup(
            <CopyButton
                value="0x1111111111111111111111111111111111111111"
                ariaLabel="Copy sequencer address"
            />,
        );

        expect(markup).toContain('>Copy</span>');
        expect(markup).toContain('aria-label="Copy sequencer address"');
    });
});
