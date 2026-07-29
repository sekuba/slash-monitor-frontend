import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type TargetBuilder = (data: { caseId?: string; network?: string; url?: string }) => string;
type WorkerListener = (event: Record<string, unknown>) => void;

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
    it('opens an exact notification case in the matching PINGME view', () => {
        const target = loadWorker('https://slashmon.example/app/').buildTarget({
            caseId: 'case:testnet:lineage:sequencer:42',
            network: 'testnet',
            url: '?view=pingme&network=testnet&case=case%3Atestnet%3Alineage%3Asequencer%3A42',
        });

        expect(target).toBe(
            'https://slashmon.example/app/?view=pingme&network=testnet&case=case%3Atestnet%3Alineage%3Asequencer%3A42',
        );
    });

    it('rejects cross-origin and out-of-scope payload targets', () => {
        const { buildTarget } = loadWorker('https://slashmon.example/app/');

        expect(buildTarget({
            caseId: 'case:mainnet:one',
            network: 'mainnet',
            url: 'https://attacker.example/steal',
        })).toBe('https://slashmon.example/app/?view=pingme&network=mainnet&case=case%3Amainnet%3Aone');
        expect(buildTarget({
            caseId: 'case:mainnet:two',
            network: 'mainnet',
            url: 'https://slashmon.example/admin/',
        })).toBe('https://slashmon.example/app/?view=pingme&network=mainnet&case=case%3Amainnet%3Atwo');
    });

    it('navigates an in-scope app client to the exact PINGME case on click', async () => {
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
                data: { caseId: 'case:mainnet:lineage:sequencer:77', network: 'mainnet' },
            },
            waitUntil: (work: Promise<unknown>) => { clickWork = work; },
        });
        await clickWork;

        expect(outsideNavigate).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith(
            'https://slashmon.example/app/?view=pingme&network=mainnet&case=case%3Amainnet%3Alineage%3Asequencer%3A77',
        );
        expect(clients.openWindow).not.toHaveBeenCalled();
    });
});
