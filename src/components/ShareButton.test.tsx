import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShareButton } from './ShareButton';

describe('ShareButton', () => {
    it('uses a compact accessible copy-link action', () => {
        const markup = renderToStaticMarkup(
            <ShareButton
                url="https://slashveto.me/?case=case%3Amainnet%3Aabc"
                ariaLabel="Copy link to this case"
            />,
        );

        expect(markup).toContain('aria-label="Copy link to this case"');
        expect(markup).toContain('text-aqua');
        expect(markup).toContain('bg-transparent');
        expect(markup).not.toContain('shadow-');
    });
});
