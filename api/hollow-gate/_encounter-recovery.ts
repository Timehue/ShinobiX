import { createHash } from 'node:crypto';
import type { HollowGateCombatBinding } from './_combat-session.js';
import type { HollowGateRunToken } from './_run-token.js';

/** The only encounter details a run owner needs to reopen a hidden fight. */
export function hollowGateEncounterRecovery(
    run: Pick<HollowGateRunToken, 'activeEncounter' | 'pendingAmbush'>,
    binding: HollowGateCombatBinding | null,
    playerName: string,
    token: string,
) {
    const pendingAmbush = run.pendingAmbush ?? null;
    const active = run.activeEncounter;
    if (!active || !binding || binding.status !== 'active'
        || binding.playerName !== playerName
        || binding.tokenDigest !== createHash('sha256').update(token).digest('hex')
        || binding.runId !== active.runId || binding.nodeId !== active.nodeId
        || binding.floor !== active.floor || binding.kind !== active.kind) {
        return { pendingAmbush };
    }
    return {
        pendingAmbush,
        activeCombat: {
            runId: active.runId,
            nodeId: active.nodeId,
            floor: active.floor,
            kind: active.kind,
            mode: binding.combatMode === 'pet' ? 'pet' as const : 'pve' as const,
        },
    };
}
