import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { battleAuthorityKeys, battleEvidenceFrom, resolveBattleAuthority } from '../_realtime/battle-authority.js';
import { battleStateKey, invalidateBattleAuthority, isBattleStateProjection, noteBattleEnded } from '../_realtime/battle-projection.js';
import { parsePvpPendingSessionPointer } from './_pending-session.js';
import type { PvpSession } from './session.js';

type PresenceStore = Pick<KvLike, 'get' | 'compareSet'> & Partial<Pick<KvLike, 'mget'>>;

/** A terminal retry may arrive after either participant starts another fight. */
export async function releasePvpTerminalPresence(store: PresenceStore, session: PvpSession): Promise<void> {
    if (session.status !== 'done') return;
    for (const role of ['p1', 'p2'] as const) {
        if (session.realFighters?.[role] === false) continue;
        const name = session[role].name;
        const keys = battleAuthorityKeys(name);
        const evidence = battleEvidenceFrom(store.mget
            ? await store.mget(...keys)
            : await Promise.all(keys.map(key => store.get(key))));
        const pointer = parsePvpPendingSessionPointer(evidence.pvpPointer, name);
        if (evidence.pvpPointer && (!pointer || pointer.battleId !== session.battleId
            || pointer.createdAt !== session.createdAt || pointer.role !== role)) continue;
        if (isBattleStateProjection(evidence.battleState)
            && evidence.battleState.sessionId !== session.battleId) continue;
        // Session bytes can change while the pointer stays identical. Never use
        // a cached active verdict to keep a just-finished duel locked.
        invalidateBattleAuthority(name);
        const authority = await resolveBattleAuthority(name, evidence, { kv: store });
        if (!authority.inBattle) {
            noteBattleEnded(name);
            const pending = onlineStore.get(name)?.pendingAttacker as { name?: unknown } | null | undefined;
            const opponent = session[role === 'p1' ? 'p2' : 'p1'].name;
            if (pending && safeName(String(pending.name ?? '')) === safeName(opponent)) {
                onlineStore.clearPendingAttacker(name);
            }
        }
        const projection = evidence.battleState;
        if (isBattleStateProjection(projection) && projection.sessionId === session.battleId) {
            // CAS protects a projection replaced while these reads were in flight.
            await store.compareSet(battleStateKey(name), projection, { ...projection, expiresAt: 0 }, { ex: 1 });
        }
    }
}
