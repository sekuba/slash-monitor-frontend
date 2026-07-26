import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
    it('uses an icon-only clipboard action with an accessible label', () => {
        const markup = renderToStaticMarkup(
            <CopyButton
                value="0x1111111111111111111111111111111111111111"
                ariaLabel="Copy sequencer address"
            />,
        );

        expect(markup).toContain('aria-label="Copy sequencer address"');
        expect(markup).not.toContain('>Copy</span>');
    });
});
