import type { Address } from 'viem';
import type { Offense } from '@/types/slashing';
export class NodeRpcClient {
    private nodeAdminUrl: string;
    private nodeAdminEnabled: boolean;
    constructor(nodeAdminUrl: string) {
        this.nodeAdminUrl = nodeAdminUrl;
        this.nodeAdminEnabled = nodeAdminUrl !== '' && nodeAdminUrl !== undefined;
    }
    private isNodeAdminAvailable(): boolean {
        return this.nodeAdminEnabled;
    }
    private async rpcCall<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                method,
                params,
                id: Date.now(),
            }),
        });
        if (!response.ok) {
            throw new Error(`RPC call failed: ${response.statusText}`);
        }
        const text = await response.text();
        if (!text || text.trim() === '') {
            throw new Error(`RPC call returned empty response for method: ${method}`);
        }
        let data;
        try {
            data = JSON.parse(text);
        }
        catch (error) {
            throw new Error(`Failed to parse JSON response for method ${method}: ${error instanceof Error ? error.message : 'Unknown error'}. Response: ${text.substring(0, 100)}`);
        }
        if (data.error) {
            throw new Error(`RPC error: ${data.error.message}`);
        }
        return data.result;
    }
    async getSlashOffenses(round: bigint | 'current' | 'all' = 'all'): Promise<Offense[]> {
        if (!this.isNodeAdminAvailable()) {
            return [];
        }
        const roundParam = typeof round === 'bigint' ? round.toString() : round;
        const rawOffenses = await this.rpcCall<any[]>(this.nodeAdminUrl, 'nodeAdmin_getSlashOffenses', [roundParam]);
        return rawOffenses.map((offense) => ({
            validator: offense.validator as Address,
            offenseType: offense.offenseType,
            amount: BigInt(offense.amount),
            epoch: offense.epoch ? BigInt(offense.epoch) : undefined,
            blockNumber: offense.blockNumber ? BigInt(offense.blockNumber) : undefined,
            round: offense.round ? BigInt(offense.round) : undefined,
        }));
    }
}
