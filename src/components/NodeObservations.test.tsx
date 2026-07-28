import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NodeObservations } from './NodeObservations';

describe('node observation presentation', () => {
    it('labels positions directly when a future offense type has no known unit', () => {
        const markup = renderToStaticMarkup(
            <NodeObservations offenses={[{
                id: 'offense-future',
                address: '0x1111111111111111111111111111111111111111',
                configuredPenalty: '0',
                offenseType: 99,
                offenseTypeName: 'unknown_99',
                epochOrSlot: '820',
                timeUnit: 'unknown',
                status: 'active',
                firstObservedAt: '2026-07-28T09:00:00.000Z',
                lastObservedAt: '2026-07-28T09:00:00.000Z',
                resolvedAt: null,
            }]} />,
        );

        expect(markup).toContain('Position 820');
        expect(markup).not.toContain('unknown 820');
    });
});
