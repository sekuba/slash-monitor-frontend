import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type TargetBuilder = (data: { validator?: string; incidentId?: string; url?: string }) => string;
type WorkerListener = (event: Record<string, unknown>) => void;

const VALIDATOR = '0x1111111111111111111111111111111111111111';

function loadWorker(scope: string, clients: Record<string, unknown> = {}) {
    const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    const listeners = new Map<string, WorkerListener>();
    const context: Record<string, unknown> = {
        URL,
        self: {
            registration: { scope },
            clients,
            addEventListener: (name: string, listener: WorkerListener) => listeners.set(name, listener),
        },
    };
    runInNewContext(source, context);
    return { buildTarget: context.safeTargetUrl as TargetBuilder, listeners };
}

describe('Web Push notification targets', () => {
    it('opens one validator in the clean hosted view', () => {
        const target = loadWorker('https://slashmon.example/app/').buildTarget({
            validator: VALIDATOR,
            incidentId: 'case-mainnet-active-42',
            url: `?utm_source=notification&validator=${VALIDATOR}`,
        });

        expect(target).toBe(`https://slashmon.example/app/?validator=${VALIDATOR}`);
    });

    it('rejects cross-origin and out-of-scope targets while preserving a valid validator', () => {
        const { buildTarget } = loadWorker('https://slashmon.example/app/');

        expect(buildTarget({
            validator: VALIDATOR,
            url: 'https://attacker.example/steal',
        })).toBe(`https://slashmon.example/app/?validator=${VALIDATOR}`);
        expect(buildTarget({
            url: 'https://slashmon.example/admin/?validator=not-an-address',
        })).toBe('https://slashmon.example/app/');
    });

    it('navigates an in-scope app client to the validator record', async () => {
        const navigate = vi.fn(async () => undefined);
        const focus = vi.fn(async () => undefined);
        const outsideNavigate = vi.fn(async () => undefined);
        const clients = {
            matchAll: vi.fn(async () => [
                { url: 'https://slashmon.example/other/', navigate: outsideNavigate, focus },
                { url: 'https://slashmon.example/app/', navigate, focus },
            ]),
            openWindow: vi.fn(async () => undefined),
        };
        const { listeners } = loadWorker('https://slashmon.example/app/', clients);
        let clickWork: Promise<unknown> | undefined;

        listeners.get('notificationclick')?.({
            notification: {
                close: vi.fn(),
                data: { validator: VALIDATOR, incidentId: 'slash-mainnet-42' },
            },
            waitUntil: (work: Promise<unknown>) => { clickWork = work; },
        });
        await clickWork;

        expect(outsideNavigate).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith(
            `https://slashmon.example/app/?validator=${VALIDATOR}`,
        );
        expect(clients.openWindow).not.toHaveBeenCalled();
    });
});
