import type { Character } from '../types/character';
import type { ResourceReceipt, ResourcePublicAttempt } from '../../../shared/resource-gathering';
import { pendingEconomyIntent, readPendingEconomyIntent, economyIntentSettled } from './economy-request-intent';
export type ResourceResponse = {
    nodes?: Record<string, import('../../../shared/shared-resource-node').SharedResourceNodeView>; sector?: number;
    ok: boolean; error?: string; character?: Character; _saveVersion?: number; receipt?: ResourceReceipt; attempt?: ResourcePublicAttempt; nodeId?: string;
    worldBossHollowShard?: { harvested: boolean; heldHollowShards: number; totalMined: number; pointsPerShard: number; filledTiers: number; maxTiers: number; damageDealtReductionPct: number; damageReceivedBonusPct: number; crystalNodeCount: number };
};
export async function resourceRequest(body: Record<string, unknown>): Promise<ResourceResponse> {
    const intent = body.action === 'start' || body.action === 'refine' ? pendingEconomyIntent('resource-gathering', [body.action, body.playerName, body.nodeId, body.mode, body.itemId, body.quantity]) : null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
        const response = await fetch('/api/world/resource', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, ...(['start', 'status'].includes(String(body.action)) ? { miningGameVersion: 2 } : {}), ...(intent ? { requestId: intent.requestId } : {}) }) });
        const result = await response.json() as ResourceResponse;
        if (intent && economyIntentSettled(response.status, result)) intent.complete();
        const active = result.character?.resourceGathering?.active;
        if (body.action === 'status' && response.ok && result.ok && active) {
            const pending = readPendingEconomyIntent('resource-gathering', ['start', body.playerName, active.nodeId, active.mode, undefined, undefined]);
            if (pending?.requestId === active.id) {
                // Finish the original admission journal before the restored attempt is played.
                const recovered = await resourceRequest({ action: 'start', playerName: body.playerName, nodeId: active.nodeId, mode: active.mode });
                if (recovered.ok) return recovered;
            }
        }
        return { ...result, ok: response.ok && result.ok };
    } catch { return { ok: false, error: controller.signal.aborted ? 'Connection timed out. Retry to recover the same attempt.' : 'Connection interrupted. Retry to recover the same attempt.' }; }
    finally { clearTimeout(timeout); }
}
