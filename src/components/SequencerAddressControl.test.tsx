import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SequencerAddressControl } from './SequencerAddressControl';

describe('SequencerAddressControl', () => {
    it('uses distinct icon actions for copy and record navigation', () => {
        const markup = renderToStaticMarkup(
            <SequencerAddressControl
                address="0x1111111111111111111111111111111111111111"
                showCopy
                onOpenRecord={vi.fn()}
            />,
        );

        expect(markup).toContain('aria-label="Copy sequencer address"');
        expect(markup).toContain('aria-label="Open sequencer record"');
        expect(markup).toContain('text-chartreuse');
        expect(markup).toContain('text-orchid');
        expect(markup).not.toContain('>Open record</button>');
    });
});
