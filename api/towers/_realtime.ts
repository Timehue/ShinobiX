import { kickTowerPlayers } from '../_realtime/notify.js';
import { towerActionVersion } from './_action-idempotency.js';
import { towerBattleLeaseMembers } from './_battle-lease.js';
import { isPublicTowerRun, isSpireRun } from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';

/** Best-effort revision kick; durable authenticated GET remains authority. */
export function publishTowerSessionKick(
    session: TowerSession,
    reason: 'started' | 'action' | 'afk' | 'settled',
): void {
    if (!isPublicTowerRun(session) && !isSpireRun(session)) return;
    kickTowerPlayers(towerBattleLeaseMembers(session), {
        channel: 'session',
        reason,
        runId: session.runId,
        actionVersion: towerActionVersion(session),
    });
}
