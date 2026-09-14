/**
 * Scheduled lapse sweep (F08).
 *
 * The owner's next heartbeat and any read of a session already terminalize a
 * lapsed fight (api/_battle-lapse.ts). This sweep is the backstop for the
 * fights nobody comes back to: it walks the per-player battle projections
 * (`battle-state:<slug>`, written at every fight start), and for each whose
 * gameplay expiry has passed asks the owning mode to reconcile it. The mode
 * re-reads its own row under its own lock, so a projection that is merely
 * stale (a PvP hint the fight has since outrun) is a cheap no-op.
 *
 * Only projections are scanned — one small row per player with a recent
 * fight — never the session rows themselves. Budgeted per tick so a backlog
 * is drained over a few ticks rather than in one long pass.
 */
import { kv as realKv, type KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import {
    BATTLE_STATE_PREFIX,
    isBattleStateProjection,
    type BattleStateProjection,
} from '../_realtime/battle-projection.js';
import { reconcileLapsedBattle, type LapseReconciliation } from '../_battle-lapse.js';

export type BattleLapseSweepResult = {
    scanned: number;
    lapsed: number;
    transitioned: number;
    settled: number;
    errors: string[];
    truncated: boolean;
};

export type BattleLapseSweepDeps = {
    kv?: Pick<KvLike, 'keys' | 'mget'>;
    now?: () => number;
    reconcile?: (lapsed: { kind: BattleStateProjection['kind']; sessionId: string }, playerName: string) => Promise<LapseReconciliation>;
    /** Maximum lapsed projections reconciled per tick. */
    budget?: number;
};

const MGET_CHUNK = 100;

export async function runBattleLapseSweep(deps: BattleLapseSweepDeps = {}): Promise<BattleLapseSweepResult> {
    const kv = deps.kv ?? realKv;
    const now = deps.now?.() ?? Date.now();
    const reconcile = deps.reconcile ?? ((lapsed, playerName) => reconcileLapsedBattle(lapsed, playerName, now));
    const budget = Math.max(1, Math.floor(deps.budget ?? 200));
    const out: BattleLapseSweepResult = { scanned: 0, lapsed: 0, transitioned: 0, settled: 0, errors: [], truncated: false };

    const keys = await kv.keys(`${BATTLE_STATE_PREFIX}*`);
    for (let i = 0; i < keys.length; i += MGET_CHUNK) {
        const chunk = keys.slice(i, i + MGET_CHUNK);
        const values = await kv.mget(...chunk);
        for (let j = 0; j < chunk.length; j += 1) {
            out.scanned += 1;
            const value = values[j];
            if (!isBattleStateProjection(value) || value.expiresAt > now) continue;
            if (out.lapsed >= budget) { out.truncated = true; return out; }
            out.lapsed += 1;
            const playerName = safeName(chunk[j].slice(BATTLE_STATE_PREFIX.length));
            try {
                const result = await reconcile({ kind: value.kind, sessionId: value.sessionId }, playerName);
                if (result.transitioned) out.transitioned += 1;
                if (result.settled) out.settled += 1;
                if (result.error && result.error !== 'in-flight') out.errors.push(`${value.kind}:${value.sessionId}: ${result.error}`);
            } catch (err) {
                out.errors.push(`${value.kind}:${value.sessionId}: ${(err as Error)?.message ?? String(err)}`);
            }
        }
    }
    return out;
}
